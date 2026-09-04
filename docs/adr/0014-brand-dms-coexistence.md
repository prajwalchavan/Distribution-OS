# ADR 0014: brand dms coexistence

Status: accepted (2026-09-04).

## Decision

Brand-mandated DMSs (Too Yumm on FieldAssist DMS, confirmed by screenshot on 2026-09-04) expose no distributor-facing API. Coexistence = (1) ingest the brand DMS secondary invoices through document intelligence and commit them as sales invoices with source = brand_dms_import, linking the brand invoice number and never issuing a second legal invoice; (2) per-brand secondary-sales/closing-stock exports in the brand layout; (3) a Tally-XML-shaped read endpoint. Decision D7.
