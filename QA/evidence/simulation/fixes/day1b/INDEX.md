# fix-day1b evidence — DOS-220, DOS-221, DOS-222

Run 2026-09-26 17:16–17:35 IST on this worktree's build: all-in-one API :3437 (`DOS_MODE=all WORKER_INLINE=1`)
against `dos_test_fixday1b` (from `dos_test_batch2b_template`, migrated to 0067, re-seeded), web export on :5437.
Screens driven with Playwright Chromium (desk 1280×800, phone 375×812) and checked in the Browser pane.
Each `.png` has a `.txt` with the page text; `wire-*.log` holds the API calls of that walk.

Setup (API, not UI): bill GKA/26-27/FIX8981 booked by vikas.kadam — three lines of Balaji Masala Masti
Wafers 45 g, batches FIX-7-A (exp 20 Oct 2026, 24 days), FIX-7-B, FIX-7-C, 96 pc each at ₹13.00, total
₹4,193.28. The GRN was opened from the desk UI. A second bill FIX9498 (FIX-8-A/B/C) was booked and opened
through the API for the re-walk.

| File | What it shows |
| --- | --- |
| `r1-01…06` | First gate walk (phone). 01 pad line 1 names batch A + "24 days left". 02/03 show the bug this lane then fixed: the pad kept the previous line's scroll, so the batch sat above the keypad out of view. 05 = failure path: saved offline → "The count was not saved: no connection", figures and batches kept. 06 saved. |
| `r2-01…06` | Re-walk after the fix: every pad line names its batch in the sticky header ("Line 2 of 3 · Batch FIX-8-B · Expires 20 Feb 2027") and in the body, starting at the top. |
| `07`, `08`, `09`, `10` | Manager desk: Goods received → GRN panel lists the three lines with batch and expiry (batch A in ochre, 24 days left) before "Post the receipt"; posted as GRN-0129. |
| `r3-desk-08`, `r3-phone-08` | The same panel at desk and phone width for FIX9498. |
| `13` | The desk's supplier-bill panel names each line's batch. |
| `sql-11` | The purchase journal the post wrote: AP −419 328, Input CGST 22 464, Input SGST 22 464, Purchases 374 400 (balances); three lots at landed cost 1 300; journal_entries 1 881 → 1 882. |
| `wire-12` | Failure path: meena.joshi (accountant) and dinesh.patil (warehouse) POST grns/:id/post → 403; the bill keeps 0 journal entries, the GRN stays reconciled. |
| `08-owner-home-before-post`, `14-owner-home-after-post-rollup` | Owner home Stock at cost ₹23,76,416.59 → ₹23,80,160.59 = +₹3,744.00 = 288 pc × ₹13.00, what the receipt cost (the old SKU default ₹13.41 would have added ₹3,862.08). |
| `wire-15` | Owner stock register total 238 016 059 paise = the home's figure to the paisa; near-expiry 18 924 208 = ₹1,89,242.08 on the home. |
