# R06 — Document AI for inbound supplier invoices (Distribution OS)

Date: 2026-09-04. Scope: photographed Indian supplier invoices that lack e-invoice data (Tally-format, multi-page, handwritten notes, poor lighting), plus the SKU-matching, confidence-routing, reconciliation, schema and review-UX design that sits on top. Everything numeric below is cited; anything I could not verify is marked **[unverified]**. Existing decisions in CONTEXT.md (photo -> LLM vision -> human review -> commit; never auto-commit; full-quality images; global product master) are respected; two recommended refinements are flagged explicitly in Section 9.

---

## 1. Executive summary

1. **Native vision LLM extraction is the right primary engine, not OCR-then-LLM.** A 2025 arXiv benchmark on ~1,850 image documents found native image input beat a Docling text-conversion pipeline by 40+ points on scanned receipts (Gemini 2.5 Pro 87.46% vs 46.54%) and by ~30 points on scanned invoices (92.71% vs 63.94%) ([arXiv 2509.04469](https://arxiv.org/html/2509.04469v1)). Layout and spatial context are what Tally invoices need ("2 Case" under a line, "x 90" in names, "continued to page 2").
2. **Across 2026 third-party invoice benchmarks, frontier VLMs (Gemini 3 Pro 94.75%, Azure DI 90.52%, Claude Sonnet 4.5 90.27%, Gemini 3 Flash 89.72%, GPT-5.2 87.59%) cluster within ~5 points; AWS Textract (82.87%) and Google Document AI Invoice Parser (79.76%) trail** ([BusinessWareTech IDP benchmark, March 2026](https://www.businesswaretech.com/intelligent-document-processing-benchmark)). None of these corpora contain Indian Tally invoices, so treat them as relative rankings only; you must build a 50–100 invoice eval set from Tarsun's real documents before choosing.
3. **Cost is not the deciding factor at distributor scale.** Modelled cost per photographed page is ~$0.03 (≈₹2.4) on Claude Sonnet 5, ~$0.07 on Opus 5, ~$0.01 on Haiku 4.5, ~$0.01–0.02 on Gemini Flash, ~$0.01 on Azure/Textract/Google specialist parsers (Section 4). A distributor doing 40 inbound invoices × 3 pages a month costs under ₹300/month on Sonnet 5. Output tokens, not image tokens, dominate LLM cost.
4. **Recommended stack:** Claude Sonnet 5 with structured outputs (`output_config.format` json_schema), all pages of one invoice in one request as labelled images, high-resolution vision (2576 px long edge, up to 4,784 visual tokens per page), prompt caching on the system prompt + schema, adaptive thinking at medium effort; escalate to Opus 5 when deterministic checks fail. Keep Gemini 3.x Flash wired as a second-opinion engine for disagreement detection (the ensemble approach reached ~99% header / ~97% line-item accuracy in the same benchmark, at ~$30/1000 pages and ~15 s).
5. **The accuracy that matters is post-validation, not raw model accuracy.** Indian invoices are unusually self-checking: line arithmetic, CGST = SGST for intra-state, Section 170 rupee rounding, mod-36 GSTIN checksum, HSN digit rules, and — for e-invoices — eight signed fields in the QR code. A deterministic validator plus the SKU matcher turns a ~90% raw extraction into a review screen where most invoices need zero edits and the rest need one or two.
6. **SKU matching is the real product moat.** Design it as a confidence-routed cascade: per-supplier alias table -> manufacturer item/article code -> HSN + brand + pack-size structured match -> trigram/BM25 -> embeddings -> human. Every human confirmation writes back to a global alias table keyed by (supplier GSTIN, normalised line text). This is the same three-band retrieve/match/escalate design shown to reduce cost by routing only medium-confidence pairs to expensive models ([arXiv 2608.25037](https://arxiv.org/html/2608.25037)).

---

## 2. What the real invoices demand (from CONTEXT.md ground truth)

| Requirement                                    | Evidence in the six real invoices                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-page with continuation                   | Guru Kripa "continued to page number 2"; Reliance "Page 1 of 2"; Guiltfree "Page 1 of 5"                                                                             |
| Case size embedded in names, quantities in pcs | "MOM Makhana 12g – Himalayan Salt N Paper **x 90**", "2 Case" sub-line, 180 pcs; Too Yumm "…21.5G(16+5.5)**\_120**", QTY 120 / Boxes 1; Campa UOM **CS1**, 700 cases |
| Complex discount stacks                        | Reliance: Base 94,801 -> Discount 42,801.66 -> Taxable 51,997.14; Guiltfree: Disc % + GST Bnft %; Guru Kripa: Disc % 8.33                                            |
| Tax split                                      | CGST 2.5 + SGST 2.5 (intra-Maharashtra); Guiltfree columns for IGST/CGST/SGST; Tax Rate 5                                                                            |
| Batch numbers                                  | Guiltfree Batch No "N526205…"                                                                                                                                        |
| Codes usable as keys                           | Reliance Article Code 494607257; Guiltfree Product Code; HSN on every line                                                                                           |
| Two inbound classes                            | (1) IRN + signed QR + e-way bill (Reliance, Guiltfree); (2) no IRN (Guru Kripa, UDYAM micro supplier)                                                                |
| Transport document                             | Sneha Logicare LR: 48 packages, invoice ref, weight 240, vehicle MH04LE3184                                                                                          |
| Header references                              | Guru Kripa "Other References: 19 Case"; Guiltfree PO no, SO no, LR no, Delivery no                                                                                   |

Implication: the extractor must return **raw** cell values as printed _and_ normalised fields (pcs, cases, case size, MRP, unit rate, taxable), with per-line page references, and never invent a line. Case size is triangulated three ways: name token, pcs ÷ cases, and the product master.

---

## 3. Engine comparison

### 3.1 Frontier vision LLMs

| Engine                                     | Evidence on invoices                                                                                                                                                                                                                                                                                                                                                                                                                                           | Multi-page                                                                                                                                                                                                    | Tables / line items                                                                                                                                                                                                                       | Notes for this use case                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude (Sonnet 5 / Opus 5 / Fable 5.1)** | Sonnet 4.5: 90.27% invoice extraction (Mar 2026, BusinessWareTech). Koncile: 97% text-PDF / 90% scanned, "best consistency of format (JSON valid in all circumstances)". RevExOS: "highest resilience on quality degradation". Roboflow Vision Evals (67 prompts, Jul 2026): Sonnet 5 70% overall, 67% on documents; Fable 5 75%; Gemini 3.5 Flash 79%. Handwriting (Jan 2026 BusinessWareTech): Claude Sonnet (version unstated) 70.34% vs GPT-5 mini 88.19%. | Up to 600 images/request (100 on 200k-context models); >20 images triggers a 2,000 px per-image cap; 10 MB/image; 32 MB/request ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)) | Structured outputs (json_schema) GA on Sonnet 5/Opus 5/Haiku 4.5 etc.; `additionalProperties:false` required; no regex/min/max in schema ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)) | High-res tier on 4.7+ models: 2,576 px long edge, 4,784 visual tokens max; standard tier (Haiku 4.5, Sonnet 4.6): 1,568 px / 1,568 tokens. Handwriting is the weak spot to test. |
| **Gemini (3.x Pro / Flash)**               | Gemini 3 Pro 94.75% (top), 3 Flash 89.72% (Mar 2026). arXiv 2509.04469: Gemini 2.5 family best on all three image datasets (scanned receipts 87.46%, scanned invoices 92.71%). Table extraction (Jun 2025): 2.5 Pro 94.2% but 47.4 s/page. Koncile: 94% on scanned (best).                                                                                                                                                                                     | PDFs to 1,000 pages / 50 MB; 3,600 images/request; native PDF text is free ([document docs](https://ai.google.dev/gemini-api/docs/document-processing))                                                       | `media_resolution` low/medium/high/ultra = 280/560/1,120/2,240 tokens per image; PDF default 560 ([media resolution](https://ai.google.dev/gemini-api/docs/media-resolution))                                                             | Strongest published numbers and cheapest Flash tier; Vertex has an India region. Best second engine.                                                                             |
| **GPT-5.x**                                | GPT-5.2 87.59%, GPT-5 mini 87.94% (Mar 2026); GPT-5 chat native 88.01% scanned invoices, 69.21% scanned receipts (arXiv). CodeSOTA: GPT-5.4 table TEDS 72.0% vs dots.ocr 88.6%.                                                                                                                                                                                                                                                                                | Image tokens via 32 px patches; cost calculator required ([OpenAI pricing](https://developers.openai.com/api/docs/pricing))                                                                                   | Weaker table TEDS in the one table-specific source                                                                                                                                                                                        | No reason to prefer over Claude/Gemini here.                                                                                                                                     |

Latency [older data, treat as indicative]: per single invoice GPT-4o 3.6 s, Claude 3.5 Sonnet 6.3 s, Gemini 2.0 Flash Thinking 8.7 s ([AIMultiple 2026 latency review](https://research.aimultiple.com/llm-latency-benchmark/)). Expect **5–20 s for a 1–5 page invoice** with structured output and thinking on; the first request after a schema change adds grammar-compile latency (cached 24 h). This is acceptable for a warehouse manager who just photographed 3 pages; show a progress state, do not block the UI.

### 3.2 Specialist cloud parsers

| Service                                               | Price (verified)                                                                                                                                                                                                                                                                                                                                          | Invoice accuracy evidence                                                                                                                                                     | Fit                                                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure AI Document Intelligence – prebuilt invoice** | $10 / 1,000 pages (S0); Read $1.50/1k (0.60 above 1M); Layout $10/1k; Custom extraction $30/1k; add-ons (high-res etc.) $6/1k each; F0 free 500 pages/month but only first 2 pages of each request ([DocuOCR summary, Aug 2026](https://docuocr.com/blog/azure-document-intelligence-pricing); official page shows placeholders)                          | 90.52% (Mar 2026); RevExOS: 93% header / **87% line items** — best line-item score among specialist tools; but "struggled with multi-word item descriptions" (Mar 2025 run)   | Best of the specialists; Hindi printed OCR supported, Hindi handwriting not. Fixed schema (no "Free Qty", "Disc %", "GST Bnft %", case sizes) — you would still need an LLM pass for Indian columns. |
| **AWS Textract AnalyzeExpense**                       | $10 / 1,000 pages first 1M, $8 above (US-West list; India region [unverified]); free tier 100 pages/month for 3 months ([Textract pricing](https://aws.amazon.com/textract/pricing/))                                                                                                                                                                     | 82.87% (Mar 2026), down from 91.1% in 2025 per RevExOS; 78% header / 82% line items                                                                                           | Languages: EN/ES/IT/PT/FR/DE only — no Hindi. LineItemGroups exist but columns are generic. Not recommended.                                                                                         |
| **Google Document AI – Invoice Parser**               | $0.10 per 10 pages (= $10/1k) first 1M pages; third-party sources claim 10-page block rounding so a 1-page invoice bills $0.10 **[unverified against Google's own page, which did not load]**; online requests max 10 pages, batch to 200 ([invoicedataextraction.com](https://invoicedataextraction.com/blog/google-document-ai-invoice-parser-pricing)) | 79.76% (Mar 2026); "failed to provide structured item breakdowns" — line items returned as unstructured text (Mar 2025 run)                                                   | Weakest on line items in every source found. Google's Gemini-based Custom Extractor / Layout Parser are the interesting parts, but that is Gemini by another door.                                   |
| **Mindee Invoice API**                                | Starter $44/month and Pro $116/month at ≈$0.044 per credit (page), 6k–300k credits; Enterprise 500k+ ([Mindee pricing](https://www.mindee.com/pricing)); an older third-party figure of $0.10 -> $0.01 per page exists [unverified/stale]                                                                                                                 | Vendor claim ">95% for most fields", computed weekly on 50+ countries ([Mindee product page](https://www.mindee.com/product/invoice-ocr-api)); no independent benchmark found | Generic invoice schema; no India-specific fields; more expensive per page than Sonnet 5. Skip.                                                                                                       |

### 3.3 Open-source

| Tool                                    | 2026 status                                                                                                                                                                                                                                                                                                | Fit                                                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PaddleOCR-VL 1.6** (0.9B, Apache-2.0) | OmniDocBench v1.6 96.33% (SOTA); 1.5 had table TEDS 91.1; ~45 pages/min on L40S, ~2 GB VRAM FP16; ~$7.27 per 10k pages self-hosted ([Spheron comparison](https://www.spheron.network/blog/best-open-source-ocr-vlm-self-host-gpu-cloud-2026/), [PaddleOCR-VL 1.6 paper](https://arxiv.org/pdf/2606.03264)) | Best open OCR/layout engine; outputs Markdown/HTML tables, not invoice JSON — still needs an LLM to map columns. Good for a later cost-down or on-prem tier. Requires GPU ops a solo dev should avoid now. |
| **dots.ocr** (1.7B, MIT)                | OmniDocBench 2025 rank 1: edit distance 0.125, table TEDS 88.6%; ~$5/1k pages self-hosted, $20/1k on Replicate ([CodeSOTA](https://www.codesota.com/ocr/best-for-invoices))                                                                                                                                | Same role as PaddleOCR-VL.                                                                                                                                                                                 |
| **Surya 2 / Marker** (650M)             | 83.3% olmOCR-bench, 5 pages/s on RTX 5090; weights under modified OpenRAIL-M (free only for startups under $5M funding/revenue) ([GitHub](https://github.com/datalab-to/surya))                                                                                                                            | License gate matters once you raise money.                                                                                                                                                                 |
| **Docling** (IBM, TableFormer)          | TableFormer 93.6% on complex tables; ~1.3 s/page digital, ~8 s/page OCR-heavy; OCR backends Tesseract/EasyOCR/RapidOCR ([LlamaIndex review](https://www.llamaindex.ai/insights/best-ai-for-pdf-table-extraction))                                                                                          | Text-conversion pipelines lost 30–40 points vs native vision on scans (arXiv 2509.04469). Not for photos.                                                                                                  |
| **Donut / LayoutLMv3**                  | 2022-era; still cited as baselines on CORD/SROIE; the 2509.04469 authors list LayoutLM/LiLT only as future fine-tuning directions                                                                                                                                                                          | Would need thousands of labelled Indian invoices to fine-tune. Not viable for a solo founder in 2026.                                                                                                      |
| **Granite-Docling** (258M)              | ~80–100 pages/min, 0.5 GB VRAM, "financial tables" strength; primarily English                                                                                                                                                                                                                             | Cheap CPU-class candidate for a future offline mode [untested on Indian invoices].                                                                                                                         |

**Verdict:** specialist parsers are cheaper per page but cannot express Indian columns (Free Qty, Disc %, GST Bnft %, Scheme, case size, Boxes, batch) without a second LLM pass, so they do not reduce LLM calls; open-source engines need GPU ops and still need an LLM to produce the schema. A frontier VLM with structured output is the only single-call path to the target JSON.

---

## 4. Cost model (verified prices, modelled usage)

Anthropic prices (first-party API, [pricing page](https://platform.claude.com/docs/en/about-claude/pricing)): Sonnet 5 $2 in / $10 out / cache read $0.20 (introductory price made permanent, per the page); Opus 5 $5 / $25 / $0.50; Haiku 4.5 $1 / $5 / $0.10; Sonnet 4.6 $3 / $15 / $0.30; Fable 5.1 $10 / $50 / $0.25. Batch API is 50% off everything and stacks with caching. 5-minute cache write is 1.25× input.

Image tokens ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)): `ceil(w/28) × ceil(h/28)`; high-res models (4.7+) downscale to 2,576 px long edge and cap at 4,784 tokens; standard models cap at 1,568. A 12 MP phone photo (4032×3024) therefore costs **4,784 tokens on Sonnet 5/Opus 5** and **1,568 tokens on Haiku 4.5/Sonnet 4.6** — high-res is ~3× the image tokens, which the docs say to use for "dense documents". Gemini 3 charges 1,120 tokens per image at default/high resolution, 560 at medium; PDF pages default to 560 ([Gemini media resolution](https://ai.google.dev/gemini-api/docs/media-resolution), [Gemini pricing, updated 2026-09-03](https://ai.google.dev/gemini-api/docs/pricing)).

Assumptions per page: image tokens as above + 400 uncached text + 2,500 cached system/schema tokens + 1,800 output tokens (a 12–15 line page with raw + normalised fields). ₹84/USD.

| Engine                                                                | $/page (interactive)                | $/page (batch) | ₹/page  | Notes                                   |
| --------------------------------------------------------------------- | ----------------------------------- | -------------- | ------- | --------------------------------------- |
| Haiku 4.5 (std-res)                                                   | 0.011                               | 0.006          | 0.9     | 1,568 px may blur 8-pt Tally text; test |
| **Sonnet 5 (hi-res)**                                                 | **0.029**                           | 0.014          | **2.4** | recommended default                     |
| Sonnet 4.6 (std-res)                                                  | 0.034                               | 0.017          | 2.8     | dominated by Sonnet 5                   |
| Opus 5 (hi-res)                                                       | 0.072                               | 0.036          | 6.1     | escalation tier                         |
| Fable 5.1 (hi-res)                                                    | 0.143                               | 0.071          | 12.0    | not justified for this task             |
| Gemini 3.8 Flash (intro $0.75/$3.75 to 31 Dec 2026, then $1.50/$7.50) | 0.008                               | 0.004          | 0.7     | second engine                           |
| Gemini 3.5 Flash ($1.50/$9)                                           | 0.019                               | 0.009          | 1.6     |                                         |
| Gemini 3.1 Pro ($2/$18)                                               | 0.036                               | 0.018          | 3.0     |                                         |
| GPT-5.4 ($2.50/$15; ~1,800 image tokens est.)                         | 0.033                               | 0.017          | 2.8     |                                         |
| Azure prebuilt invoice                                                | 0.010                               | —              | 0.8     | + LLM pass still needed                 |
| Textract AnalyzeExpense                                               | 0.010                               | —              | 0.8     | no Hindi                                |
| Google Invoice Parser                                                 | 0.010 (possibly 0.10 per short doc) | —              | 0.8–8.4 | line items weak                         |

Scale check: Tarsun at ~40 invoices × 3 pages/month ≈ ₹300/month on Sonnet 5. At 1,000 distributors × 30 invoices × 3 pages = 90k pages/month ≈ $2.6k/month (₹2.2 lakh) on Sonnet 5 interactive — roughly ₹220 per distributor per month, well inside a subscription. Add ~30% if you always run a Gemini Flash second opinion. Output tokens are ~60% of the Claude cost, so keep the schema tight (no verbose descriptions echoed back) and do not ask for prose.

Data residency: the Claude API is global by default; `inference_geo:"us"` costs 1.1×; there is no India region on the first-party API. Vertex AI offers Claude and Gemini with regional endpoints at a 10% premium. Indian B2B invoice data is not personal data under DPDP for the most part, but note it in the security doc **[legal position unverified]**.

---

## 5. India-specific extraction quirks and deterministic validators

These checks are what convert raw model output into trustworthy review-screen defaults. They run server-side after extraction, before SKU matching.

| Quirk                                           | Rule / validator                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GSTIN**                                       | 15 chars: 2-digit state code (Maharashtra = 27), 10-char PAN, entity digit, "Z", mod-36 check char. Compute checksum over first 14 chars (values 0–35, alternate weights 1/2 from the right, digit-sum each product, check char makes total ≡ 0 mod 36). A checksum fail on an extracted GSTIN is almost always an OCR error (0/O, 1/I, 8/B, 5/S) — auto-try the confusion-set substitutions before flagging.        | [HelloBooks validator](https://hellobooks.ai/tools/gstin-validator), [Gokhale, Medium](https://medium.com/@dhananjaygokhale/decoding-gst-number-checksum-digit-1ef2c8c53ad6)              |
| **Intra- vs inter-state**                       | If supplier and buyer GSTIN state codes match -> expect CGST + SGST (equal amounts, equal rates); else IGST only. Mismatch = red flag on the tax block.                                                                                                                                                                                                                                                              | GST law; visible on invoice A (CGST 2.5 + SGST 2.5)                                                                                                                                       |
| **HSN digits**                                  | AATO ≤ ₹5 cr: min 4-digit HSN on B2B invoices; > ₹5 cr: min 6 digits (since 1 Apr 2021; GSTR-1 Phase 3 from Jan/May 2025 enforces dropdown selection). Validate length ∈ {4,6,8}, numeric, and that the prefix exists in the HSN master; keep an HSN -> expected GST-rate table in the product master and flag rate mismatches (rates changed in the Sept 2025 GST restructuring, so keep the table date-versioned). | [PIB release](https://www.pib.gov.in/PressReleasePage.aspx?PRID=1708713&reg=48&lang=2), [ClearTax](https://cleartax.in/s/mandatory-hsn-code-reporting-gstr1-1a)                           |
| **Rounding**                                    | Section 170 CGST Act: tax and total rounded to nearest rupee (≥50 paise up) at invoice level, per tax component; line items are not rounded. Accept                                                                                                                                                                                                                                                                  | computed − printed                                                                                                                                                                        | ≤ ₹1 per tax component and ≤ ₹1 on grand total; a "Round Off" line is normal and should be captured as its own field. | [ClearTax Section 170](https://cleartax.in/s/rounding-off-tax-section-170-gst) |
| **Rs formatting**                               | Indian digit grouping (94,801.00; 1,23,456.78), "Rs", "₹", "INR", trailing "/-", "Dr/Cr", amount-in-words line ("Rupees Fifty Four Thousand…"). Parse by stripping non-digits except the last dot; use amount-in-words as a cross-check on the grand total (ask the model to extract it verbatim).                                                                                                                   | invoices A–F                                                                                                                                                                              |
| **e-invoice QR**                                | Signed QR is a JWT (header.payload.signature) whose payload has 8 fields: seller GSTIN, buyer GSTIN, doc no, doc date, total invoice value, number of line items, main-item HSN, IRN. Decode on-device (ML Kit / ZXing) — no network needed; signature verification against the NIC public key is optional. Use `number of line items` as a hard check on extracted line count and `total value` on the grand total. | [Masters India](https://www.mastersindia.co/blog/signed-qr-code-e-invoicing-system/), [TaxGuru](https://taxguru.in/goods-and-service-tax/signed-qr-code-e-invoicing-system-gst-faqs.html) |
| **Who has IRN**                                 | Mandatory for suppliers with AATO > ₹5 cr in any FY since 2017-18 (threshold unchanged since 1 Aug 2023); once crossed, permanent. So Reliance/Guiltfree always have IRN; UDYAM micro suppliers like Guru Kripa never will. Store `supplier.einvoice_expected` and flag a large supplier's invoice that lacks an IRN.                                                                                                | [Xflow e-invoice limit](https://www.xflowpay.com/blog/e-invoice-limit)                                                                                                                    |
| **Case sizes in names**                         | Patterns observed: ` x 90`, `_120`, `(16+5.5)` (base + promo grammage), `CS1` UOM, `2 Case` sub-line, `Boxes` column, header "Other References: 19 Case". Extract `pack_size_hint_raw` verbatim and let the normaliser derive `case_size = qty_pcs / cases` when both exist; cross-check with the name token; disagreement -> amber.                                                                                 | invoices A, B, C                                                                                                                                                                          |
| **Free Qty / schemes**                          | Separate `free_qty` column (E, F) or "Scheme" text; free units carry zero value but still enter stock. Extract as its own field, never fold into qty.                                                                                                                                                                                                                                                                | invoices E, F                                                                                                                                                                             |
| **Disc % / GST Bnft % / secondary + cash disc** | Preserve every discount column verbatim with its label; compute `taxable = (qty × rate) − discounts` and compare to printed taxable.                                                                                                                                                                                                                                                                                 | invoices A, C, E                                                                                                                                                                          |
| **Handwriting**                                 | Warehouse staff pencil in short-shipments, damaged counts, tick marks. Ask the model for a separate `handwritten_annotations[]` list (text + page + nearby line index) rather than letting it alter printed values. Claude's handwriting score in the one benchmark found was 70% vs GPT-5 mini 88% — test on real annotations; Hindi handwriting is unsupported by all three cloud OCRs.                            | BusinessWareTech Jan 2026; Azure/Textract language docs                                                                                                                                   |
| **Poor lighting / skew**                        | Do capture-side deskew, glare warning and auto-crop (ML Kit Document Scanner on Android, VisionKit on iOS) but store the original frame. Anthropic warns accuracy drops on "low-quality, rotated, or very small images under 200 pixels" and that heavy JPEG compression hurts text. Never recompress below quality 90 (Vyapar's compression complaint is a documented churn reason).                                | [Claude vision limitations](https://platform.claude.com/docs/en/build-with-claude/vision)                                                                                                 |
| **Multi-page**                                  | Send all pages of an invoice in one request as `Page 1:` … `Page N:` labelled image blocks (docs recommend labels); extract `page_of_total` from "Page 1 of 5"; block commit if captured pages < declared total; line tables that continue across pages must be merged with running-total continuity checks.                                                                                                         | Claude multi-image docs                                                                                                                                                                   |

**Hallucinated lines** are the hardest error to catch (RevExOS). Mitigations: require `evidence.page` and `evidence.row_text` per line; enforce line count vs QR `number of line items` when available; enforce Σ line taxable = printed subtotal; show the row crop next to each line in review.

---

## 6. Recommended extraction pipeline

1. **Capture (Manager app):** multi-page flow with page counter; on-device document scanner; QR scan per page; immediate upload of originals to object storage (S3/GCS) under `tenant/supplier/invoice-uuid/page-n.jpg`; offline queue.
2. **Pre-classification (server, cheap):** decode QR JWT if present -> `einvoice` block; look up supplier by GSTIN (creates supplier master if new); pick prompt profile per known supplier layout (Tally, SAP-Reliance, Guiltfree-DMS) — profiles are just few-shot hints, not templates.
3. **Extraction call (Claude Sonnet 5):** one request per invoice with all pages as image blocks (pre-resized to 2,576 px long edge to save bandwidth; token cost is identical), system prompt + JSON schema behind a `cache_control` breakpoint, `output_config.format` = json_schema (Section 8), `thinking: {type:"adaptive"}` with `output_config.effort: "medium"`, `max_tokens` ~16k, streaming on. Use the SDK's `messages.parse()` helper for local validation of constraints the grammar cannot express (regex, min/max are unsupported in the API schema — put them in field descriptions and validate locally).
4. **Deterministic validation:** Section 5 rules -> per-field status (green/amber/red) and per-invoice reasons.
5. **Escalation:** if ≥2 red arithmetic checks or page-count mismatch, re-run on Opus 5 (or Gemini 3 Flash as a cheap dissenting opinion) and keep the version that satisfies more checks; log both for eval.
6. **SKU matching (Section 7)** -> match status per line.
7. **Review screen (Section 10)** -> human confirms -> **GRN commit**: stock-ledger entries (with batch, expiry, cost) + purchase invoice record + alias-table learning + eval-log write. Purchase price is written with the owner/manager visibility scope only (salesperson role must never receive these rows).
8. **Migration / backfill:** old invoices go through the Batch API (50% off, no user waiting).

Why not Batch for interactive? A manager is standing at the dock; batch turnaround is not bounded. Why one request per invoice rather than per page? Cross-page continuity ("continued…", running totals) and one schema instance per invoice; a 5-page invoice is 5 × 4,784 = ~24k image tokens, trivially inside the window.

---

## 7. SKU-matching layer design

Goal: map each extracted line to a `product_id` in the **global** product master (shared across tenants per the existing decision), producing a calibrated confidence and learning from every correction.

### 7.1 Normalisation

- Uppercase, collapse whitespace, strip punctuation except `+ . %`, normalise units (`GM|GMS|G` -> `g`, `ML` -> `ml`, `LTR|L` -> `l`, `PC|PCS|NOS` -> `pcs`), expand common brand abbreviations (`TY!` -> `TOO YUMM`), transliterate Hindi tokens to Latin (ICU transliteration) so `मखाना` and `MAKHANA` collide.
- **Pack-size parser** (regex + small grammar): weight/volume (`12g`, `21.5G`, `1L`, `500ml`), promo grammage `(16+5.5)` -> net 21.5 with `promo_extra=5.5`, case size tokens (` x 90`, `_120`, `/120`, `CS1`, `1x90`), MRP tokens (`MRP 10`, `Rs 5`). Output a typed struct `{brand?, variant_tokens[], net_qty, net_unit, case_size?, mrp?}`.
- Derive `case_size_from_qty = qty_pcs / cases` when both present (180/2 = 90); compare with name-token case size.

### 7.2 Candidate generation (cheap -> expensive)

1. **Per-supplier alias table hit:** `(supplier_gstin, normalised_text) -> product_id` with `confirm_count`, `reject_count`, `last_confirmed_at`. Exact hit with ≥2 confirms and 0 recent rejects = auto-match (still displayed). This is the highest-precision path and is where most lines land after the first month with a supplier.
2. **External codes:** manufacturer item/article code (Reliance 494607257, Guiltfree Product Code, DMS Item ERP Id) -> `product_external_codes(manufacturer_id, code, product_id)`. Codes are stable across distributors, so this table is global too.
3. **Structured filter:** restrict to products with the same HSN (4-digit prefix), same brand when the brand lexicon fires, and same MRP ± ₹0 when MRP was extracted (MRP is a near-unique key in Indian FMCG).
4. **Lexical:** Postgres `pg_trgm` similarity and a BM25 index over `product.name + aliases`; take top 20.
5. **Embeddings:** pgvector over normalised names using a multilingual embedding model (Voyage `voyage-3` family or open `bge-m3`; pick by a quick recall test on 200 real lines) — catches "Himalayan Salt N Paper" vs "Salt & Pepper".
6. **Rerank + score fusion:** weighted logistic score over features: alias hit, code hit, HSN match, brand match, MRP match, net-quantity match, case-size match, trigram sim, embedding sim, unit-rate within ±10% of last purchase price for the candidate. Start with hand-set weights; fit logistic regression once you have ~1,000 confirmed pairs.

### 7.3 Decision bands and routing

Follow the three-band pattern from the product-linking paper ([arXiv 2608.25037](https://arxiv.org/html/2608.25037)): HIGH band tuned to ≥98% precision -> auto-selected; LOW band -> "no match, create product?"; MEDIUM -> show top-3 chips. Initial cut-offs (score 0–1): ≥0.90 green, 0.60–0.90 amber, <0.60 red. Re-tune monthly from logged outcomes (precision per band). Optionally escalate MEDIUM pairs to a small LLM call ("is X the same SKU as Y? consider pack size and MRP") — the paper's expected cost formula `E[c] = c_cheap + p(MEDIUM) × c_expensive` says the escalation rate is the cost lever, so tighten features before adding LLM calls.

### 7.4 Learning loop

- On confirm: upsert alias `(supplier_gstin, normalised_text) -> product_id`, `confirm_count++`; also upsert `(manufacturer_id, external_code)` if present; append to `product.aliases[]` (global, deduplicated) so other tenants benefit.
- On correction (user picks a different product): `reject_count++` on the wrong alias; create the new alias; write the pair to `match_training_pairs` with both candidates' feature vectors for later weight fitting.
- On "create new product": product goes into the global master as `status=proposed` with tenant-visible immediate use; a moderation queue (you, initially) merges duplicates; merges rewrite aliases and ledger references.
- Nightly job: recompute per-supplier and per-band precision; alert when a band's precision drops below target.

### 7.5 Global-master governance

Because aliases are keyed by supplier GSTIN and product codes by manufacturer, they are tenant-neutral and safe to share. Tenant-specific facts (purchase price, retailer price, stock) never enter the matcher's global tables — only the `unit_rate_vs_last_price` feature reads the tenant's own history.

---

## 8. Proposed JSON extraction schema

Constraints from the Claude structured-outputs grammar: `additionalProperties:false` everywhere, all fields required (use `null` for absent), no `pattern`/`minimum`/`maxLength` (put them in descriptions; validate locally), `enum` allowed. Money is a **string** exactly as printed plus a parsed numeric after local validation (avoids float drift and preserves "94,801.00"). Abbreviated for length; every object in production carries the same `additionalProperties:false` + `required` pattern.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "document",
    "supplier",
    "buyer",
    "invoice",
    "pages",
    "line_items",
    "tax_summary",
    "totals",
    "einvoice",
    "transport",
    "references",
    "handwritten_annotations",
    "extraction_notes"
  ],
  "properties": {
    "document": {
      "type": "object",
      "additionalProperties": false,
      "required": ["doc_type", "title_as_printed", "copy_type", "software_hint"],
      "properties": {
        "doc_type": {
          "type": "string",
          "enum": [
            "tax_invoice",
            "bill_of_supply",
            "delivery_challan",
            "credit_note",
            "debit_note",
            "lorry_receipt",
            "other"
          ]
        },
        "title_as_printed": { "type": ["string", "null"] },
        "copy_type": {
          "type": ["string", "null"],
          "description": "e.g. ORIGINAL, Seller Copy 1/3"
        },
        "software_hint": {
          "type": ["string", "null"],
          "description": "Tally, SAP, DMS, thermal, unknown"
        }
      }
    },
    "supplier": { "$ref": "#/$defs/party" },
    "buyer": { "$ref": "#/$defs/party" },
    "invoice": {
      "type": "object",
      "additionalProperties": false,
      "required": ["number", "date", "due_date", "place_of_supply", "reverse_charge", "currency"],
      "properties": {
        "number": { "type": ["string", "null"] },
        "date": {
          "type": ["string", "null"],
          "description": "ISO 8601 date; printed formats vary (dd-mm-yyyy, dd/mm/yy)"
        },
        "due_date": { "type": ["string", "null"] },
        "place_of_supply": { "type": ["string", "null"] },
        "reverse_charge": { "type": ["boolean", "null"] },
        "currency": { "type": "string", "enum": ["INR"] }
      }
    },
    "pages": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "page_index",
          "printed_page_label",
          "declared_total_pages",
          "continues_to_next",
          "quality"
        ],
        "properties": {
          "page_index": { "type": "integer" },
          "printed_page_label": { "type": ["string", "null"], "description": "e.g. 'Page 1 of 5'" },
          "declared_total_pages": { "type": ["integer", "null"] },
          "continues_to_next": { "type": ["boolean", "null"] },
          "quality": {
            "type": "string",
            "enum": ["good", "blurry", "glare", "cropped", "skewed", "dark"]
          }
        }
      }
    },
    "line_items": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["line_no", "evidence", "raw", "normalized", "field_confidence"],
        "properties": {
          "line_no": { "type": "integer" },
          "evidence": {
            "type": "object",
            "additionalProperties": false,
            "required": ["page_index", "row_text"],
            "properties": {
              "page_index": { "type": "integer" },
              "row_text": {
                "type": "string",
                "description": "verbatim row text incl. sub-lines like '2 Case'"
              }
            }
          },
          "raw": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "description",
              "product_code",
              "hsn",
              "batch_no",
              "expiry",
              "mrp",
              "qty",
              "qty_uom",
              "cases",
              "free_qty",
              "rate",
              "rate_per",
              "disc_pct",
              "disc_amt",
              "scheme_text",
              "gst_benefit_pct",
              "taxable",
              "tax_rate_pct",
              "cgst_amt",
              "sgst_amt",
              "igst_amt",
              "cess_amt",
              "line_total",
              "other_columns"
            ],
            "properties": {
              "description": { "type": "string" },
              "product_code": { "type": ["string", "null"] },
              "hsn": { "type": ["string", "null"] },
              "batch_no": { "type": ["string", "null"] },
              "expiry": { "type": ["string", "null"] },
              "mrp": { "type": ["string", "null"] },
              "qty": { "type": ["string", "null"] },
              "qty_uom": {
                "type": ["string", "null"],
                "description": "PCS, CS1, BOX, NOS as printed"
              },
              "cases": {
                "type": ["string", "null"],
                "description": "from Boxes column or '2 Case' sub-line"
              },
              "free_qty": { "type": ["string", "null"] },
              "rate": { "type": ["string", "null"] },
              "rate_per": { "type": ["string", "null"] },
              "disc_pct": { "type": ["string", "null"] },
              "disc_amt": { "type": ["string", "null"] },
              "scheme_text": { "type": ["string", "null"] },
              "gst_benefit_pct": { "type": ["string", "null"] },
              "taxable": { "type": ["string", "null"] },
              "tax_rate_pct": { "type": ["string", "null"] },
              "cgst_amt": { "type": ["string", "null"] },
              "sgst_amt": { "type": ["string", "null"] },
              "igst_amt": { "type": ["string", "null"] },
              "cess_amt": { "type": ["string", "null"] },
              "line_total": { "type": ["string", "null"] },
              "other_columns": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["label", "value"],
                  "properties": { "label": { "type": "string" }, "value": { "type": "string" } }
                }
              }
            }
          },
          "normalized": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "brand_guess",
              "variant_text",
              "net_qty_value",
              "net_qty_unit",
              "promo_extra_value",
              "case_size_hint",
              "qty_pcs",
              "qty_cases",
              "pack_size_hint_raw"
            ],
            "properties": {
              "brand_guess": { "type": ["string", "null"] },
              "variant_text": { "type": ["string", "null"] },
              "net_qty_value": { "type": ["number", "null"] },
              "net_qty_unit": {
                "type": ["string", "null"],
                "enum": ["g", "kg", "ml", "l", "pcs", null]
              },
              "promo_extra_value": { "type": ["number", "null"] },
              "case_size_hint": {
                "type": ["integer", "null"],
                "description": "from 'x 90', '_120'"
              },
              "qty_pcs": { "type": ["integer", "null"] },
              "qty_cases": { "type": ["number", "null"] },
              "pack_size_hint_raw": { "type": ["string", "null"] }
            }
          },
          "field_confidence": {
            "type": "object",
            "additionalProperties": false,
            "required": ["description", "qty", "rate", "taxable", "hsn"],
            "properties": {
              "description": { "$ref": "#/$defs/conf" },
              "qty": { "$ref": "#/$defs/conf" },
              "rate": { "$ref": "#/$defs/conf" },
              "taxable": { "$ref": "#/$defs/conf" },
              "hsn": { "$ref": "#/$defs/conf" }
            }
          }
        }
      }
    },
    "tax_summary": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["hsn", "taxable", "rate_pct", "cgst", "sgst", "igst", "cess"],
        "properties": {
          "hsn": { "type": ["string", "null"] },
          "taxable": { "type": ["string", "null"] },
          "rate_pct": { "type": ["string", "null"] },
          "cgst": { "type": ["string", "null"] },
          "sgst": { "type": ["string", "null"] },
          "igst": { "type": ["string", "null"] },
          "cess": { "type": ["string", "null"] }
        }
      }
    },
    "totals": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "subtotal",
        "total_discount",
        "total_taxable",
        "total_cgst",
        "total_sgst",
        "total_igst",
        "total_cess",
        "round_off",
        "grand_total",
        "amount_in_words",
        "total_qty",
        "total_cases"
      ],
      "properties": {
        "subtotal": { "type": ["string", "null"] },
        "total_discount": { "type": ["string", "null"] },
        "total_taxable": { "type": ["string", "null"] },
        "total_cgst": { "type": ["string", "null"] },
        "total_sgst": { "type": ["string", "null"] },
        "total_igst": { "type": ["string", "null"] },
        "total_cess": { "type": ["string", "null"] },
        "round_off": { "type": ["string", "null"] },
        "grand_total": { "type": ["string", "null"] },
        "amount_in_words": { "type": ["string", "null"] },
        "total_qty": { "type": ["string", "null"] },
        "total_cases": {
          "type": ["string", "null"],
          "description": "e.g. 'Other References: 19 Case'"
        }
      }
    },
    "einvoice": {
      "type": "object",
      "additionalProperties": false,
      "required": ["irn", "ack_no", "ack_date", "qr_present", "eway_bill_no"],
      "properties": {
        "irn": { "type": ["string", "null"], "description": "64 hex chars" },
        "ack_no": { "type": ["string", "null"] },
        "ack_date": { "type": ["string", "null"] },
        "qr_present": { "type": "boolean" },
        "eway_bill_no": { "type": ["string", "null"] }
      }
    },
    "transport": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "transporter_name",
        "lr_no",
        "lr_date",
        "vehicle_no",
        "packages",
        "weight",
        "delivery_no"
      ],
      "properties": {
        "transporter_name": { "type": ["string", "null"] },
        "lr_no": { "type": ["string", "null"] },
        "lr_date": { "type": ["string", "null"] },
        "vehicle_no": { "type": ["string", "null"] },
        "packages": { "type": ["string", "null"] },
        "weight": { "type": ["string", "null"] },
        "delivery_no": { "type": ["string", "null"] }
      }
    },
    "references": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "po_no",
        "po_date",
        "so_no",
        "other_references",
        "payment_terms",
        "bank_details_present",
        "upi_present"
      ],
      "properties": {
        "po_no": { "type": ["string", "null"] },
        "po_date": { "type": ["string", "null"] },
        "so_no": { "type": ["string", "null"] },
        "other_references": { "type": ["string", "null"] },
        "payment_terms": { "type": ["string", "null"] },
        "bank_details_present": { "type": "boolean" },
        "upi_present": { "type": "boolean" }
      }
    },
    "handwritten_annotations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["page_index", "text", "near_line_no", "kind"],
        "properties": {
          "page_index": { "type": "integer" },
          "text": { "type": "string" },
          "near_line_no": { "type": ["integer", "null"] },
          "kind": {
            "type": "string",
            "enum": ["tick", "quantity_change", "shortage", "damage", "signature", "stamp", "other"]
          }
        }
      }
    },
    "extraction_notes": {
      "type": "array",
      "items": { "type": "string" },
      "description": "ambiguities the model could not resolve; never silently guess"
    }
  },
  "$defs": {
    "party": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "gstin",
        "pan",
        "address",
        "state_code",
        "phone",
        "udyam_no",
        "fssai_no"
      ],
      "properties": {
        "name": { "type": ["string", "null"] },
        "gstin": { "type": ["string", "null"], "description": "15 chars; validated locally" },
        "pan": { "type": ["string", "null"] },
        "address": { "type": ["string", "null"] },
        "state_code": { "type": ["string", "null"] },
        "phone": { "type": ["string", "null"] },
        "udyam_no": { "type": ["string", "null"] },
        "fssai_no": { "type": ["string", "null"] }
      }
    },
    "conf": { "type": "string", "enum": ["high", "medium", "low"] }
  }
}
```

Two notes. First, model self-reported confidence is only weakly calibrated in general; use it as one feature among the deterministic checks, not as the routing signal on its own **[general caution, not measured for this task]**. Second, keep `raw.*` as strings exactly as printed — the normaliser and validator do all parsing, so a wrong parse is fixable without re-running the model.

---

## 9. Confidence scoring, routing, and reconciliation

### 9.1 Per-field status

`status = f(model_confidence, validator_results, cross-source agreement, image_quality, sku_match_band)`:

- **Green** — passes all applicable checks and (if applicable) agrees with QR/PO; auto-filled, one-tap confirm.
- **Amber** — a soft check failed (rounding within ±₹1 but confidence medium; case size derived ≠ name token; SKU band medium) — highlighted, must be looked at, one-tap accept allowed.
- **Red** — hard failure (arithmetic off by > ₹1, GSTIN checksum fail after confusion-set retry, line count ≠ QR count, page missing, SKU band low, tax split inconsistent with state codes) — must be edited before commit.

Per-invoice: commit blocked while any red exists; the summary bar shows "computed vs printed" for taxable, tax, and grand total.

### 9.2 Reconciliation against PO and LR (three-way match at GRN)

- **PO vs invoice:** the distributor's PO in the system is in cases; invoice lines are in pcs. Compare `qty_pcs / case_size` to ordered cases per product; compare invoice unit rate and MRP to the agreed price list; over-supply, short-supply and unexpected SKUs become amber/red rows; free-qty lines are matched to the scheme master, not the PO.
- **LR vs invoice:** LR package count (48) is matched to the invoice's declared cases (`totals.total_cases`, Σ `cases` column, or "Other References: 19 Case"); an LR can reference several invoices (LR carries invoice numbers) and one invoice can span LRs, so the match is many-to-many on invoice number.
- **Physical count vs both:** the manager enters a counted-boxes number at the gate before opening the review screen (a single number, entered blind, to avoid anchoring). Boxes counted ≠ LR packages -> transporter shortage/damage claim workflow; boxes = LR but pcs on inspection < invoice -> supplier shortage; per-brand return policy determines whether a debit note or a claim is raised.
- **Commit artifact:** a Goods Receipt Note linking invoice, LR, PO and count; stock-ledger entries reference the GRN; discrepancies become separate ledger/claim entries, never silent adjustments.

### 9.3 Two recommended refinements to existing decisions

1. **"Zero manual entry" should become "zero manual _typing_".** One deliberate manual number — counted packages at the gate — is what makes the LR reconciliation trustworthy, and it takes five seconds. (Reason: an auto-extracted package count cannot detect a missing carton.)
2. **Store a Claude/Gemini disagreement log from day one**, even if you run only one engine in production. It is the cheapest way to build the eval set and to know when a supplier's format has drifted.

---

## 10. Review-screen UX outline (Manager app, phone-first)

1. **Header card:** supplier (matched by GSTIN, green/amber), invoice no/date, grand total (computed vs printed, with rounding delta), IRN badge when QR decoded, page thumbnails with a "3 of 5 pages captured" warning if short.
2. **Gate count prompt** (before lines): "How many boxes arrived?" numeric keypad; shows LR packages after entry.
3. **Line list:** one card per line with a **row-crop strip** from the original image (using `evidence.page_index` + the row text to locate; store a bbox if you later add a layout model), the matched product chip (green tick / amber "3 candidates" / red "no match"), qty pcs · cases · case size, MRP, rate, taxable. Tap a field -> inline numeric keypad; tap the chip -> candidate sheet (top 3 with pack size and MRP side by side, search box, "Create new product"). Swipe -> "not received / short / damaged" with a count.
4. **Batch/expiry step** for lines whose product master says batch-tracked: prefilled from extraction, editable, with a per-batch quantity split.
5. **Totals bar** pinned: Σ lines vs printed subtotal/tax/total; turns green only when within tolerance; shows which line is off when red.
6. **Handwritten annotations panel:** shows detected pencil marks with the crop; the manager applies them as line adjustments or dismisses them.
7. **Commit button** disabled while any red remains; commit creates the GRN and returns to the queue; an undo window of 15 minutes reverses ledger entries with a compensating entry.
8. **Owner-side exception queue:** invoices with price deviations vs price list, unknown SKUs, or supplier mismatch appear in the Distributor app approvals queue.
9. **Language:** Hindi/English labels; every state also expressed with colour and icon.
10. **Target:** a green 10-line invoice confirmed in under 60 seconds; red invoices under 3 minutes. Measure and show median time-to-commit in the owner dashboard.

---

## 11. Open questions and what to measure first

- Build the eval set: 50–100 real inbound invoices (all three suppliers, both classes, including bad photos and handwritten marks) with ground truth entered once. Score field-level accuracy, line recall/precision, and post-validation review edits per invoice for Sonnet 5, Opus 5, Haiku 4.5 (standard-res), and Gemini 3.x Flash/Pro. Everything in Section 3 is a prior, not a result, for Indian Tally layouts.
- Whether Haiku 4.5's 1,568 px cap is enough for dense Tally 8-pt tables — decides whether a ₹1/page tier is feasible.
- Hindi handwriting: no cloud OCR supports it; Claude/Gemini performance on pencil annotations is unmeasured.
- Google Document AI's per-10-page block billing claim is from third parties; the official page did not load.
- Textract India-region pricing and Azure commitment-tier prices were not directly verifiable.
- Van sales (open from earlier chats) affects whether a "stock out to vehicle" document is also photographed and reconciled.

---

## Sources

- Claude vision docs (limits, token formula, tiers): https://platform.claude.com/docs/en/build-with-claude/vision
- Claude PDF support: https://platform.claude.com/docs/en/build-with-claude/pdf-support
- Claude pricing (models, cache, batch): https://platform.claude.com/docs/en/about-claude/pricing
- Claude structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- BusinessWareTech IDP benchmark (Mar 2026 invoices, Jan 2026 handwriting, Jun 2025 tables): https://www.businesswaretech.com/intelligent-document-processing-benchmark and https://www.businesswaretech.com/blog/research-ai-models-invoice-processing-benchmark
- RevExOS invoice parsing benchmark (Jul 2026): https://revexos.com/blog/best-ai-model-for-invoice-parsing
- Koncile Claude vs GPT vs Gemini (Jun 2026): https://www.koncile.ai/en/ressources/claude-gpt-or-gemini-which-is-the-best-llm-for-invoice-extraction
- arXiv 2509.04469 native vision vs text parsing: https://arxiv.org/html/2509.04469v1
- Roboflow Claude Sonnet 5 vision evals: https://blog.roboflow.com/claude-sonnet-5-for-vision/
- Gemini pricing (updated 2026-09-03): https://ai.google.dev/gemini-api/docs/pricing ; media resolution: https://ai.google.dev/gemini-api/docs/media-resolution ; document processing: https://ai.google.dev/gemini-api/docs/document-processing ; image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- AWS Textract pricing: https://aws.amazon.com/textract/pricing/ ; AnalyzeExpense API: https://docs.aws.amazon.com/textract/latest/APIReference/API_AnalyzeExpense.html
- Azure Document Intelligence pricing summary: https://docuocr.com/blog/azure-document-intelligence-pricing ; official page: https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/ ; language support: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/language-support/ocr?view=doc-intel-4.0.0
- Google Document AI invoice parser pricing (third party): https://invoicedataextraction.com/blog/google-document-ai-invoice-parser-pricing ; official: https://cloud.google.com/document-ai/pricing
- Mindee pricing: https://www.mindee.com/pricing ; product: https://www.mindee.com/product/invoice-ocr-api
- Open-source OCR comparison: https://www.spheron.network/blog/best-open-source-ocr-vlm-self-host-gpu-cloud-2026/ ; CodeSOTA invoice OCR: https://www.codesota.com/ocr/best-for-invoices ; PaddleOCR-VL 1.6: https://arxiv.org/pdf/2606.03264 ; Surya: https://github.com/datalab-to/surya ; Docling/TableFormer: https://www.llamaindex.ai/insights/best-ai-for-pdf-table-extraction ; OmniDocBench: https://github.com/opendatalab/OmniDocBench
- Product linking cascade (Retrieve, Match, Escalate): https://arxiv.org/html/2608.25037 ; product reconciliation RAG: https://doi.org/10.3390/jrfm19060402 (page returned 403; abstract only)
- GSTIN mod-36 checksum: https://hellobooks.ai/tools/gstin-validator ; https://medium.com/@dhananjaygokhale/decoding-gst-number-checksum-digit-1ef2c8c53ad6
- HSN digit rules: https://www.pib.gov.in/PressReleasePage.aspx?PRID=1708713&reg=48&lang=2 ; https://cleartax.in/s/mandatory-hsn-code-reporting-gstr1-1a
- Section 170 rounding: https://cleartax.in/s/rounding-off-tax-section-170-gst
- e-invoice threshold: https://www.xflowpay.com/blog/e-invoice-limit ; signed QR contents: https://www.mastersindia.co/blog/signed-qr-code-e-invoicing-system/ ; https://taxguru.in/goods-and-service-tax/signed-qr-code-e-invoicing-system-gst-faqs.html
- Latency references: https://research.aimultiple.com/llm-latency-benchmark/
