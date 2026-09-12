# Batch 1 regression — new findings (2026-09-13)

Found while re-testing the merged batch 1 fixes (Charter A.12). Not approved for fixing; they go to the next approval gate.
Environment for all: local dev, services on merged main (after 2abb27e), database `dos_qa` (realistic seed of 2026-09-12).

### DOS-115 — Warehouse and delivery logins can cancel, re-line and submit any order in the distributorship (DOS-073 residual)
Category: security | Priority: P0 | Role: Warehouse, Delivery | Platform: Backend API (warehouse-service :3004, delivery-service :3005); every client that holds such a token

```
User: Warehouse, Delivery
Platform: Backend API (warehouse-service :3004, delivery-service :3005); every client that holds such a token
Environment: local dev, merged main after batch 1 lanes, dos_qa
Steps:
  1. As rahul.deshmukh on sales-service :3003, create and submit SO-0889 (R-0015 Ganpati General Stores) and SO-0891 (R-0011 Sai Baba Kirana); both auto-confirm with stock reserved. 2. As dinesh.patil (warehouse): POST http://127.0.0.1:3004/orders/01a09720-9222-79e0-84df-d32e045e090a/cancel {reason}. 3. As ganesh.more (delivery): POST http://127.0.0.1:3005/orders/01a09722-307c-780b-904e-906efd15dc0a/cancel {reason}. 4. As rahul, create draft 01a09726-51a8… (R-0015). dinesh POST :3004/orders/{id}/lines replaces 6 pc with 2 pc; ganesh POST :3005/orders/{id}/submit. 5. GET :3004/orders?limit=200 and :3005/orders?limit=200.
Expected: 403/404. A godown picker or a van driver has no business cancelling, re-lining or submitting a rep's order, and should not browse every order of the tenant. The DOS-073 rule ('a salesperson reaches only its own orders') has no equivalent for these roles.
Actual: Every call returned 200. SO-0889 and SO-0891 are cancelled; order_state_transitions cancel rows carry actor_id 5b6fbe87 (dinesh.patil) and 7b2db500 (ganesh.more); reservations voided; OrderCancelled outbox events; order_cancelled WhatsApp to +919820021437 and SMS to +918655015314 were sent to the shops. The draft was re-lined by the warehouse and submitted by delivery, becoming SO-0893 auto-confirmed under ganesh's actor id. Both lists return 200 rows from every rep (rahul 90, amit 82, others) across 52 shops, with a next page. Cause per the DOS-073 verifier: ORDER_ROLES = STAFF, the matrix entry is ANY_MEMBER, both services mount `orders`, and callerReaches narrows only the salesperson role.
Business impact: Any godown or van login, including a lost driver's phone or a disgruntled helper, can silently cancel every confirmed order in the distributorship, or rewrite and confirm drafts. The shop receives an official 'order cancelled' message, stock is released, and the sale is lost. It is the same class of unauthorised order access as DOS-073 (P0), reachable from two more apps.
Severity: P0
Evidence: QA/evidence/batch1/regression/api-security/b-01-warehouse-list-all-orders.txt; QA/evidence/batch1/regression/api-security/b-02-delivery-list-all-orders.txt; QA/evidence/batch1/regression/api-security/b-03-warehouse-cancel-rahul-order-B.txt; QA/evidence/batch1/regression/api-security/b-04-delivery-cancel-rahul-order-B2.txt; QA/evidence/batch1/regression/api-security/b-07-db-after-warehouse-delivery-cancel.txt; QA/evidence/batch1/regression/api-security/b-08-warehouse-setlines-rahul-draft-E.txt; QA/evidence/batch1/regression/api-security/b-09-delivery-submit-rahul-draft-E.txt; QA/evidence/batch1/regression/api-security/b-10-db-after-warehouse-setlines-delivery-submit.txt; QA/evidence/batch1/regression/api-security/b-11-db-messages-reservations.txt
Suggested fix: A founder/matrix decision is needed. Proposal: remove warehouse and delivery from orders.cancel, orders.setLines and orders.submit (and orders.create unless a van-sale flow needs it) in backend/libs/contracts/src/permissions.ts, or refuse those roles in the order service's reach check, and scope orders.list/get for them to what their work needs (orders on their picklists and trips). Add the cases to describePermissionMatrix and an orders spec, as DOS-073 did for the salesperson.
```

Found by: security regression probe (batch 1), residual of DOS-073 raised by its verifier.

### DOS-116 — A desk credit note for damaged goods puts the pieces back into saleable stock unless each line explicitly says saleable:false
Category: business-logic | Priority: P1 | Role: Manager (the endpoint also serves owner, accountant and delivery) | Platform: Backend API (manager-service :3002, POST /credit-notes); the manager-app UI was not tested

```
User: Manager (the endpoint also serves owner, accountant and delivery)
Platform: Backend API (manager-service :3002, POST /credit-notes); the manager-app UI was not tested
Environment: local dev, merged main after batch 1 lanes, dos_qa
Steps:
  1. Own fixture: SO-0892 (R-0027 Gupta Kirana Stores) waved, picked and packed → INV/9007, 6 pc Balaji Masala Masti Wafers 45 g, lot GK20260721. Godown on_hand for the lot is 13. 2. As vikas.kadam: POST http://127.0.0.1:3002/credit-notes {id, invoiceId: INV/9007, reason: 'return_damaged', autoIssue: true, lines: [{id, invoiceLineId, qtyPcs: 2}]}, with saleable omitted as CreditNoteLineInput allows (default true). 3. Query credit_note_lines and stock_ledger for the note. 4. Control: the same request with saleable:false.
Expected: A note whose reason is return_damaged sends its pieces to the damaged bin, or the server refuses saleable:true with that reason. deliveries.record now does exactly that with 400 return_not_saleable (DOS-058).
Actual: 200, CN/9005 issued with reason return_damaged, but credit_note_lines.saleable = true and stock_ledger shows sale_return_saleable +2 into Godown (kind warehouse); Godown on_hand 13 → 15. Only with an explicit saleable:false (control CN/9006) did the pieces go to the Damaged / expiry bin as sale_return_damaged.
Business impact: Damaged returns booked at the desk become sellable stock and are picked for the next shop. The damaged bin, the brand damage claim and the stock valuation are understated, and a credit note labelled 'damaged' contradicts its own stock movement. It is the same outcome DOS-058 fixed at the doorstep, still reachable from the office.
Severity: P1
Evidence: QA/evidence/batch1/regression/api-security/e-06-warehouse-pack-and-bill-W.txt; QA/evidence/batch1/regression/api-security/e-07-db-invoice-W-and-stock-before-credit-note.txt; QA/evidence/batch1/regression/api-security/e-08-manager-credit-note-return-damaged-default-lines.txt; QA/evidence/batch1/regression/api-security/e-09-db-after-credit-note-default-lines.txt; QA/evidence/batch1/regression/api-security/e-10-manager-credit-note-return-damaged-saleable-false-control.txt; QA/evidence/batch1/regression/api-security/e-11-db-after-credit-note-saleable-false.txt
Suggested fix: In billing.creditNotes.create/issue, derive each line's disposition from the reason (return_damaged → saleable false) or reject saleable:true with return_damaged (400 return_not_saleable, reusing isSaleableReturn). Stop defaulting CreditNoteLineInput.saleable to true for damage reasons. Add a billing spec, and check that the manager and owner credit-note screens send the disposition the user chose.
```

Found by: security regression probe (batch 1), residual of DOS-058 raised by its verifier.

