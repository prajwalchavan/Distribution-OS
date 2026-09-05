# Import fixtures

In-repo files the integrations spec uploads through the real wizard (`files.uploadUrl` → PUT →
`imports.create`), one per built-in profile. Their headers are EXACTLY the guessed column names in
`profiles.data.ts` (docs/17 §D7: no vendor export has been seen yet; the profiles are refined the day a
real file arrives — the mapping screen, never a code change). Every row is designed to exercise one
outcome of the dry run: a match by phone / code / EAN / alias / name, a new shop, a garbled phone or
amount, a state written as a name, a duplicate inside the file, a blank footer line.

The spec substitutes the EANs (`8901234500011` …) with run-specific ones because `product_variants.ean`
is globally unique; everything else is used as written. `tradeezee-party-master.xlsx` is written by the
spec from the CSV with the dependency-free writer in `xlsx.ts`, so the XLSX path is tested end to end.
