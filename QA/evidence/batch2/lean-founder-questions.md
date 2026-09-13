# Batch 2 lean designs — founder questions

From the Fable lean designs (run `wf_1c5f484c-b7b`). Each item is designed for the recommended default; it is built only after the founder approves the default or picks an alternative. Full designs: `QA/evidence/batch2/verdicts/lean-<group>.md`.

## Q1. DOS-066 (lean-delivery-collect)

A shop on today's trip is on credit mode 'stop' (or has bills past their due date). May the crew hand over the goods, which the office already invoiced and loaded — or must the app stop them?

**Recommended default:** Hand over, but tell them: the door shows the overdue amount, the oldest due date and how many days late, and a 'stop' shop gets a 'Credit stopped' chip with 'take the money before the goods go in'. No block on the phone or the server — the credit gate stays at order submit, where this bill was approved. 'strict' looks the same as 'indicate' at the door.

- Alternative: Block on the server: deliveries.record refuses delivered/partial for a 'stop' shop with overdue bills (409 credit_stopped; a 2xx rejection offline) unless a receipt on this trip has cleared the overdue amount; a failed stop stays possible and the goods ride back to the van.
- Alternative: Collect first on the phone only: a confirm sheet before Deliver on a 'stop' shop ('Take the money first?'), no server rule.
- Alternative: Also flag 'strict' shops with a softer ochre 'Credit watched' chip.

## Q2. DOS-071 (lean-delivery-collect)

Must a trip expense (diesel, toll, parking) carry a photo of its bill before it can be recorded?

**Recommended default:** Yes, at or above a per-distributor amount, ₹200 unless the owner changes it (0 = every expense): diesel always has a pump bill, a ₹30 parking slip often does not. The rule runs on the server for the crew and the desk alike, and the phone says why the button is off.

- Alternative: Always, for every rupee (the same setting with default 0).
- Alternative: Never — keep today's optional photo and only nudge on the phone.
- Alternative: Per kind: diesel always, toll and parking never (a second setting).
- Alternative: A three-word policy like the POD one (always / above_amount / never) — the same thing with more words.

## Q3. DOS-054 (lean-warehouse-rules)

Below how many days of remaining shelf life should the godown stop sending a batch to shops — and is that a warning the picker can go past, or a block that needs a reason or a manager?

**Recommended default:** One number for the whole business, 30 days, set in owner Settings. Stock reservation and the pick sheet pass over such batches whenever another batch can cover the line; a picker who still takes one gets a red warning the desk can see, but is not stopped (FEFO warns, it never blocks — the rule the warehouse already follows).

- Alternative: Block unless the picker records an override reason on that line (refused online, a recorded sync rejection offline), the desk sees the reason.
- Alternative: Block, and only the owner or manager may approve it from the manager app, like load-out.
- Alternative: A different number per product category (needs a category attribute on the catalog first — phase 2).
- Alternative: No rule: keep the amber expiry badge as today.

## Q4. DOS-006 (lean-owner-money-approvals)

When you approve an 'Over credit limit' request, should approving let only that one order through (the shop's limit stays as it is; you change the limit on the shop's page), or should approving also raise the shop's credit limit?

**Recommended default:** Only this order goes through. The screen says so and gives a one-tap link to change the shop's limit on the shop's page (audited, as today).

- Alternative: Approving also raises the limit to a figure you type in the dialog, permanently, recorded as a limit change (a small contract change: an optional new limit on the decision).
- Alternative: A temporary raise until a date that reverts on its own (needs a new column, a migration and a nightly job; phase 2, not this batch).

## Q5. DOS-016 (lean-owner-money-approvals)

On the owner's home screen, should 'Outstanding' stay the total of open bills (₹44,24,374) with the ₹35,080 already received on account shown beside it and the net stated, or should the headline itself become the net figure (₹43,89,294) that equals Sundry Debtors in the books?

**Recommended default:** Keep the headline as open bills, show 'less ₹35,080 on account' beside it, and state the net on the Money screen so it always matches the books. Nothing already stored changes meaning.

- Alternative: Make the headline the net figure (tile = books); the ageing ladder, the outstanding history chart and the shop register still sum to open bills, so the on-account line is needed there anyway and those would need re-defining later.
- Alternative: Show both numbers as two tiles (Open bills · Net dues).

## Q6. DOS-081 (lean-sales-orders-pricing)

When a shop set to 'Warn at the limit' places an order that takes it past its credit limit, should the order go through and the office see a warning on it, be held for approval like a strict shop, or should only the rep be warned?

**Recommended default:** The order goes through (no hold) and carries a credit notice: the rep sees 'over the limit — warn only' before placing, and the manager's order list and detail show the same notice on the confirmed order. Strict and stop keep holding as today. docs/22 §4 is corrected to say so.

- Alternative: Hold warn-mode breaches for approval too (docs/22 §4 read literally) — this makes 'warn' identical to 'strict', so the mode would have no meaning.
- Alternative: Warn the rep only and record nothing for the office (the code today); docs/22 §4 is corrected the other way.

## Q7. DOS-087 (lean-sales-orders-pricing)

'₹15 off per case on 2+': is that ₹15 on every case once the shop buys two or more (₹30 on 2 cases, ₹45 on 3), or ₹15 for every two cases (today's engine)?

**Recommended default:** ₹15 on every case once two are bought. The engine gains a 'per unit amount' reward (per case or per piece, above a threshold, with slabs), the seeded scheme is moved to it, and flat 'per multiple' schemes keep working as they do.

- Alternative: Keep the engine and rename the seeded scheme to '₹15 off per 2 cases' (cheapest: seed and docs only; the product then cannot express per-case-off schemes).

## Q8. DOS-100 (lean-retailer-platform)

When a shop's order is held for the distributor's approval, should the app's message 'We have your order, {distributor} will confirm shortly' be in-app only (free) or also a paid WhatsApp/SMS message? And is it right that the shop sees how much of its earlier bills is overdue but never how much credit it has left (ADR 0006)?

**Recommended default:** In-app only for the hold message (no per-message cost, no Meta template approval, the shop just used the app); the order screen shows the overdue amount with a Pay button and never a credit limit or credit-available figure.

- Alternative: Also send it on WhatsApp (falls back to SMS) using the shop's opt-in — costs per message and needs the template approved by Meta; the seed already carries the wording, so it is a one-line switch later.
- Alternative: Show 'credit available' on the retailer app — contradicts ADR 0006 and the CREDIT_CHECKERS matrix; would need that decision revoked first.

## Q9. DOS-102 (lean-retailer-platform)

After sign-in, where should a shop that buys from several distributors land: in the distributor it used last on that device (the first one on a fresh install) with one home that shows every distributor's dues, live delivery and the total — or on a 'choose your distributor' screen first?

**Recommended default:** Land in the distributor used last on that device (first membership on a fresh install) and show one combined home: each distributor's dues, last bill and any van on the way, plus the total owed. No chooser: it would ask a question before showing anything.

- Alternative: A chooser screen before the home (one more tap on every open; the combined home still needed behind it).
- Alternative: Always the first distributor (today's behaviour), with the combined home.

## Q10. DOS-103 (lean-retailer-platform)

Which number should a shop see and tap in the app — one office number the owner sets in Settings (used for both Call and WhatsApp), or the shop's own salesperson's number? And should 'report a problem / ask for a return' land as a message in the office's inbound queue for the desk to act on, or become a return request the delivery crew picks up at the next visit?

**Recommended default:** One office number set by the owner in Settings, for Call and WhatsApp; the report lands in the office's inbound queue with its kind and the bill or delivery it names, the desk triages it, and the credit note is raised as today (at the door or by the desk).

- Alternative: Show the shop's own salesperson's number (needs the beat assignment per shop and exposes staff personal numbers to customers; the office number can still be added later as a second button).
- Alternative: A first-class return request the crew acts on at the next visit (a new aggregate with a crew screen and a state machine — a module slice, not a batch-2 fix).

## Q11. DOS-138 (lean-manager-order-lifecycle)

When a shop phones during picking, may the desk (owner or manager) cancel the order — the hold is released, the picker's sheet shows which lines to put back, and no GST invoice is issued — while a packed order is cancelled only through its bill and after dispatch only a credit note applies?

**Recommended default:** Yes: the desk may cancel up to and including picking; reps and shops keep today's limits; packed orders are cancelled through the bill (DOS-139); after dispatch a credit note. This stops every mid-pick cancellation from burning a legal invoice number and leaves no order stuck in picking with stock reserved.

- Alternative: Keep docs/22's 'cancel only up to confirmed': hide Cancel on picking and packed orders and state the route 'finish packing, then cancel the bill' (costs an invoice number and GST paperwork per cancellation; orders stay in picking with stock held until then).
- Alternative: Let every role that may cancel today (owner, manager, salesperson, retailer within their reach) also cancel during picking (the floor learns of a cancellation from a rep's phone with no desk in the loop).
- Alternative: A desk 'stop picking' that returns the order to confirmed and re-waves it later (needs a picking→confirmed edge, re-reservation and a second wave; larger, and still no answer for a shop that no longer wants the goods).

