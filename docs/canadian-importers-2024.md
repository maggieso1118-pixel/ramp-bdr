# Canadian Importers Database 2024 integration

The Major Importers by city workbook is connected to the existing local evidence workflow. The directory's **Enrich for ICP** button reads the configured local workbook, prepares candidates, matches identities, and publishes importer presence. This phase ends at evidence. Jev, ICP scores, tiers, rankings, buyer discovery, triggers, and outreach remain unimplemented.

## Inspected source

| Property | Actual value |
| --- | --- |
| Original filename | `cid-bdic-majorimportersbycity2024.xls` |
| Actual file format | XLSB (Excel binary workbook inside ZIP), despite the `.xls` extension |
| Worksheet | `pQRY003_CITY` (the only sheet) |
| Used range | `A1:F15835` |
| Header rows | 1 |
| Data rows | 15,834 |
| Data year | 2024 in every row |
| Exact unique rows | 15,829 |
| Exact duplicate groups / excess rows | 5 / 5 |
| Distinct original company names | 15,814 |
| Repeated original company-name groups | 14 (20 excess occurrences) |
| Distinct normalized names | 15,793 |
| Normalized name + city + province + postal identities | 15,820 |
| Repeated normalized identity groups / excess rows | 14 / 14 |
| Canadian-location rows | 14,004 |
| US-state-location rows | 1,830 |
| Missing postal codes | 1,830, all on US-state rows |
| Missing name, city, English province, French province, or year | 0 |
| Source SHA-256 | `e1a76733dac41d24092f04d90d1d7a62d678f58cb2d1f64a35be7fa57805bf25` |

Exact column headers, in order:

1. `CITY-VILLE`
2. `COMPANY-ENTREPRISE`
3. `PROVINCE_ENG`
4. `PROVINCE_FRA`
5. `POSTAL_CODE-CODE_POSTAL`
6. `DATA_YEAR-ANNÉE_DES_DONNÉES`

Every populated postal code has a plausible Canadian format. There is no leading/trailing whitespace in the inspected text cells. Province entries include US states; this is not a list restricted to Canadian registered addresses. The workbook has no country column, stable company identifier, product classifications, origin countries, spending, revenue, or employee counts.

Names can recur at different locations, and legal-form/punctuation variants sometimes share a location. For example, `R & L EQUIPMENT` and `R&L EQUIPMENT LTD.` in Alma share a normalized identity. Five pairs are exact repeats, including `STERLMAR EQUIPMENT` and `PIXIE CANDY SHOPPE`. Several company-name fields contain administrative-looking text, including variants of `RELEASE PRIOR TO PAYMENT`. These source values are retained and subjected to the same conservative identity rules; no business facts are inferred from them.

## Identity, year, and duplicate semantics

The adapter namespace is `canadian_importers_database_2024`, displayed as **Canadian Importers Database 2024**. A stable source key is the SHA-256 of the normalized company name, city, province, postal code, and absent country. It represents a name/location group, not a government-issued company ID. The key does not depend on row order or filename. Different locations remain separate source identities; normalization-equivalent repeated listings share an identity.

All 15,834 raw rows remain available per run, including duplicates. `source_record_id` is `pQRY003_CITY!<worksheet row>` and `row_number` is the real 1-based Excel row, including the header. Original nulls and cell values are preserved. The normalized identity is stored separately. No country is fabricated from the dataset's title; US-state names cannot provide Canadian province support.

Accepted identity groups publish one observation: **`is_importer = true`**. Year **2024** is stored in both row attributes and observation provenance. `observed_at` stays null because the workbook supplies a year, not a precise date. No row counts or repeat counts are published as measures of import activity. These are directory listings, not transactions or shipments.

Two source identities can legitimately match one corporation, so observation count can exceed distinct corporations. The first run includes two source identity groups matched to `AIR NORTH CHARTER & TRAINING LTD.` (corporation `4203658`). Each observation keeps its own row provenance.

## Matching rules and limitations

The existing `registry-v3` candidate rules and `match-v1` assessments are unchanged. Name normalization folds accents, punctuation and trailing legal forms. The batch matcher requires a unique exact primary or alternate name with province support and no known city/province/country conflict. Equal city and province yields excellent rule strength; province-only support can yield strong strength when no city conflict is known. Postal equality is additional recorded evidence, not a substitute for identity support.

Fuzzy matches are candidates only. Multiple plausible matches and retrieval-limit cases are ambiguous. Exact-name retrieval remains capped at 100; location fallback remains capped at 1,000. Reaching a cap prevents acceptance. Confidence numbers describe rule strength, not calibrated probabilities. Registered addresses may differ from operating locations, and the federal CBCA registry does not contain every Canadian business.

These limits are deliberately unchanged for this integration. The match rate is an observed result, not an optimization target. Missing importer evidence remains unknown; the adapter never publishes `is_importer = false`.

## Actual first-run results

| Measure | Result |
| --- | ---: |
| Source rows processed | 15,834 |
| Unique source name/location identities | 15,820 |
| Accepted source identities | 993 |
| Distinct matched corporations | 992 |
| Ambiguous identities | 3,098 |
| Ambiguous because of retrieval limits | 3,097 |
| Ambiguous because of multiple plausible corporations | 1 |
| Probable fuzzy matches awaiting review | 24 |
| Other unmatched identities | 11,705 |
| Total unmatched including probable matches | 11,729 |
| Evidence observations created | 993 |
| Evidence observations updated / removed | 0 / 0 |
| Repeated normalized-identity rows retained | 14 |
| Duration, including initial candidate location preparation | 206.033 seconds |

All 993 accepted identities had excellent rule strength (exact name, city and province). Six matched a registry alternate name. Postal codes were equal for 817 accepted identities. Postal differences remain recorded; they do not imply that a registered address is an operating headquarters.

The disjoint identity counts reconcile: **993 accepted + 3,098 ambiguous + 24 probable + 11,705 other unmatched = 15,820**. The runner's `unmatchedSourceCompanies` counter includes its `probableMatches` subset.

## Operation and safeguards

The original file is preserved in Downloads. A byte-identical copy lives in ignored runtime storage at `data/cid-bdic-majorimportersbycity2024.xls`. Set `BDR_CANADIAN_IMPORTERS_PATH` to override the browser workflow's path; restart the server after changing it. CLI usage:

```sh
pnpm import:evidence canadian-importers /path/to/cid-bdic-majorimportersbycity2024.xls
```

SheetJS 0.20.3 is pinned to the [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). It detects XLS, XLSX, and XLSB contents. The adapter requires the inspected worksheet, six exact headers, and year 2024. It rejects formulas, error cells, invalid identity types, and different schemas/years. The small workbook is decoded in memory, with a 20 MiB file limit and a 100,000-data-row limit. The generic importer stages batches of 1,000 rows on disk.

The browser POST endpoint uses only the configured local path. It streams progress and completion/errors to the button. A database-specific exclusive file lock serializes browser and CLI evidence imports. Navigation ends the progress connection but lets the local import finish. A hard-killed process can leave a running audit and lock; confirm that it has stopped before removing that exact lock file. Run only one registry/evidence importer per database at a time.

Publication occurs in a single SQLite transaction. A successful import replaces this adapter's complete 2024 snapshot and removes stale observations. A failed import retains previously published observations. New runs preserve raw-row history; repeated runs update existing observation IDs. Source year is part of the namespace so a future 2025 adapter need not erase 2024 evidence.

## Validation

The baseline before CID import was **645,204 registry records**, **391,327 candidates**, with registry source-row SHA-256:

`b7ebc497ca1ccbde502b13edb8bf86b1c5d64be0338fa46684e427ad13147f8e`

The repeat-run verifier checks identical acceptance counts and observation IDs/values/creation times; no inserted or removed observations; unchanged complete registry checksum; fresh profiles and reproducible candidate pagination; SQLite, foreign-key and full-text integrity; searches; province filtering; pagination; corporation detail data and source provenance; and exact-name/geographic acceptance rules. It writes the measured report to `data/cid-validation.json`:

All of those checks passed on October 4, 2026. The second run took **170.414 seconds**, reproduced all first-run match counts, and updated the same **993 observation IDs**, with **zero creations and zero removals**. All **645,204 source records** retain the exact baseline checksum, and all **391,327 candidates** were returned exactly once. A repeated profile backfill changed zero rows. All **20 tests**, TypeScript checking, and the production build passed. The original workbook and the local runtime copy have identical source hashes.

```sh
pnpm verify:cid data/cid-bdic-majorimportersbycity2024.xls data/registry-before-cid.json data/cid-validation.json
pnpm test
pnpm typecheck
pnpm build
```

Automated tests exercise real XLSB/XLSX/XLS readers with the exact schema, original row numbers, raw cells, stable keys after reorder, duplicate grouping, exact and alternate names, geographic conflicts, ambiguity, fuzzy review, unknown evidence, invalid source rejection, idempotence, rollback, locking, and the in-process streaming POST endpoint.

Browser visual/click-through verification is unavailable: the browser tool's administrator-enforced security check could not be verified. No workaround was used. Build, component/API code checks, in-process endpoint tests, and database validation are independent of that limitation.
