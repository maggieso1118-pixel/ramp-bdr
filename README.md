# BDR Agent / Ramp — Canadian importer evidence

A local Next.js App Router prototype with a real, searchable Canadian federal corporation directory.

**CSV → federal corporation registry → deterministic candidate preparation → Canadian Importers Database 2024 evidence**

The real Major Importers by city 2024 workbook is connected to the evidence workflow. `/corporations` can run local deterministic matching and show matched importer presence with workbook-row provenance. A separate, explainable commercial-likelihood score now ranks all 391,327 eligible registry identities for later research; use “Rank by commercial likelihood” in the directory and open a company to see its component breakdown. It is **not** a Ramp ICP score. Jev and AI qualification remain unimplemented. See [the scoring rules and full-data cutoff analysis](docs/commercial-likelihood.md) and [the CID source and validation report](docs/canadian-importers-2024.md). Historical verification sections below describe earlier phases.

## Run locally

Requirements: **Node.js 24+** (built-in SQLite and TypeScript stripping) and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:3100. The homepage now starts with a real drag-and-drop CSV upload. After the government CSV is checked, it opens the real directory. If records are already loaded, the homepage also offers a direct link to them.

## Import

Choose or drop the Canadian federal active-corporations CSV on the homepage. The browser sends it only to the local Next.js server on `127.0.0.1`; the server writes a bounded stream to a temporary file, checks the configured SHA-256, calls the existing importer, and removes the temporary file. The upload shows actual transfer percentage followed by a processing state. A 200 MiB limit covers the current 103.7 MB source file. Once complete, the directory displays its current database count. Re-uploading the same file reports unchanged records instead of creating duplicates.

For this local demo, `lib/corporations/browser-import.ts` pins browser uploads to the October 2026 government CSV by SHA-256. To use a newly downloaded government snapshot, set `BDR_GOVERNMENT_CSV_SHA256` to its SHA-256 and restart the local server. The importer also validates the government file's 18-column header. This is a local demo upload endpoint, not a general customer CSV importer.

The command-line importer remains available from the project root:

```sh
pnpm import:companies /path/to/corporations-active-cbca-en.csv
```

This source path is documentation only; application logic does not hardcode it. The original CSV remains in its original location. The browser upload uses a temporary copy and deletes it after processing.

The database defaults to `data/corporations.sqlite`, relative to the project root. Optionally export `BDR_DATABASE_PATH` to the same location for both CLI and app. No API key is required. The CLI does not automatically load Next's `.env.local`.

```sh
BDR_DATABASE_PATH=/absolute/path/corporations.sqlite pnpm import:companies /path/to/source.csv
BDR_DATABASE_PATH=/absolute/path/corporations.sqlite pnpm dev
```

Database files, journal files, `data/`, `datasets/`, and government CSV filenames are ignored by Git. They are runtime artifacts, not source code or build assets.

## What is real

- BOM-aware, quoted-field-aware parsing of all 18 government columns.
- Original parsed cells preserved in `raw_data`, alongside normalized fields.
- SQLite `accounts` and an `imports` audit record for each attempt.
- Actual database counts; no hardcoded real-data totals.
- Server-side search and province filtering at `/corporations`, rendering at most 25 accounts per page.
- Real source-backed details at `/corporations/[sourceId]`: legal/alternate names, corporation and business numbers, status, legislation, registered address, filing dates, director limits, and provenance.
- Expandable original source values on each detail page.

This file covers **federal corporations under the CBCA**, not every business operating in Canada. Registered addresses are not inferred operating headquarters, and director limits are not employee counts.

## Import and source fidelity

The registry importer uses `csv-parse`, 64 KiB file chunks, prepared statements, transactions of 1,000 records, and disk-backed temporary IDs to detect duplicates within a file. It retains only a bounded batch in JavaScript memory. SQLite WAL permits reading committed rows during an import. The separate Excel evidence adapter uses SheetJS 0.20.3 from its official distribution.

- Corporation number (`source_id`) is unique. **Business number is not unique.** Leading zeros remain intact.
- Unchanged re-imports skip existing records. Changed rows update in place, preserving account ID and original import timestamp.
- For duplicate corporation numbers within one file, the first occurrence wins. Duplicates are included in `skipped_existing` and separately counted in `duplicate_source_ids`.
- `processed = inserted + updated + skipped_existing + invalid`.
- Optional blanks become null in normalized fields; original empty strings remain in raw data. Missing names do not discard an identifiable record.
- Missing corporation numbers and wrong field counts are counted as invalid. Up to ten issue descriptions are retained.
- Unsupported headers, malformed quoting, unreadable input, or database failures fail visibly. Committed batches remain; re-running is safe. Hard process termination can leave an attempt marked `running`; a subsequent import remains idempotent.
- Dates, filing years, and director minimums/maximums remain text. Unusual values are not silently corrected.
- Original province and postal fields are retained separately. Normalized `NF` becomes `NL`; already plausible postal codes receive spacing/case formatting. O/0 are never substituted; invalid-looking codes are not repaired.
- Display whitespace may be trimmed/collapsed. Raw data preserves parsed cell content, including whitespace, but not CSV quoting syntax or the BOM.
- The parser rejects records larger than 1 MiB as an explicit failure, rather than allocating unbounded memory.

Reports include processed, inserted, updated, unchanged/duplicate skipped, invalid, duplicates, duration, completion state, and errors. CLI output also includes database count/size and peak process memory. Run one importer per database at a time.

## Search

SQLite FTS5 indexes legal name, alternate name, corporation number, business number, and city. Matching is case/accent-insensitive and uses **word prefixes**, with multiple terms combined with AND. `shop` matches words beginning with “shop”; `toronto` can match a city or a company-name field. This is not arbitrary substring search or a city-only filter.

Queries use bound parameters, safely tokenized FTS terms, and a limit of 120 characters/eight terms. At least one term must contain two characters. Province filters use normalized codes. Results default to stable source order; the optional commercial-likelihood order is a deterministic research-priority view, not ICP ranking. Pagination URLs retain the search, province, and chosen order; each page contains at most 25 records.

Conventional indexes also cover legal/alternate names, corporation number, business number, city, and province. FTS triggers maintain search data after inserts and updates. No complete table is sent to the client or searched in browser memory.

## Legacy fictional sample

The older `/import/demo` page and `/account/[id]` sample details remain available at their direct URLs. Their eight fictional accounts, scores, triggers, and buyer-persona suggestions stay labeled as samples. The homepage upload no longer leads to them.

The real registry pages use separate database functions and never import the fixture modules.

## Verification

Browser upload checks on October 2, 2026: the full 103,665,471-byte government CSV was streamed through the new browser import service. It returned 645,204 total records and 645,204 unchanged rows, with zero inserts, updates, or invalid rows. Twelve tests now pass, including real file streaming into an isolated database, repeat uploads, changed records, rejected files, and the previous registry tests. The production build includes `/api/registry/import`.

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm verify:companies 645204
```

The optional numeric argument asserts the expected count in the verifier; it is not an application count. Verification checks SQLite/FTS integrity, unique corporation IDs, representative queries, source-only detail data, and pagination.

Full-source results on October 1, 2026:

| Check | Result |
| --- | --- |
| CSV size | 103,665,471 bytes |
| First import | 645,204 processed and inserted |
| Invalid rows / duplicate corporation IDs | 0 / 0 |
| First import duration | 136.7 seconds |
| Re-import | 645,204 unchanged; 0 inserted; 0 updated |
| Re-import duration | 12.2 seconds |
| Final count | 645,204 |
| Shared business-number groups | 5, preserved |
| Database after checkpoint | 827,707,392 bytes / 789.4 MiB |
| Peak importer memory | About 142 MiB initially, 150 MiB on re-import |
| SQLite / full-text index integrity | Passed |

Representative database timings (count plus one result page; warm median of three local runs):

| Query | Matches | Time |
| --- | ---: | ---: |
| `8660115` — corporation number | 1 | 0.07 ms |
| `8448566 Canada` — numbered name | 1 | 13.12 ms |
| `MINDANGLER` — named corporation | 1 | 0.07 ms |
| `Toronto` | 82,928 | 92.74 ms |
| `Vancouver` | 10,205 | 14.38 ms |
| `835752437` — business number | 1 | 0.07 ms |
| `shop` | 719 | 1.05 ms |
| `FNX Management Inc.` — alternate name | 1 | 0.34 ms |

These are database timings, not browser latency. Broad queries and deep offset pages may cost more. The current representative checks found no material latency issue for the local prototype. Raw source preservation and indexes make the database substantially larger than the CSV.

Focused tests cover browser uploads, BOMs, quoted commas/newlines/quotes, leading zeros, shared business numbers, optional blanks, duplicate source IDs, unusual values, province/postal fidelity, idempotence, updates/FTS synchronization, invalid input, failed-import recovery, safe query handling, and pagination.

Browser UI verification was blocked by an unavailable admin-enforced browser security check. No bypass was attempted. Compilation, type checks, importer tests, and full-dataset checks are independent of that limitation.

## File map

Added:

- `lib/db/database.ts`: schema, indexes, FTS triggers, local connection.
- `lib/corporations/{types,normalize,import,queries}.ts`: models, fidelity, importer, bounded queries.
- `scripts/import-companies.ts`, `scripts/verify-companies.ts`: repeatable import and validation.
- `tests/corporations.test.ts`: isolated synthetic import/search/recovery tests.
- `app/corporations/page.tsx`, `app/corporations/[sourceId]/page.tsx`: real list and detail views.
- `app/corporations/{error,loading,not-found}.tsx`, `app/error.tsx`: graceful states.

Modified:

- `app/page.tsx`, `components/upload.tsx`: real CSV upload and direct access to an already imported directory.
- `app/api/registry/import/route.ts`, `lib/corporations/browser-import.ts`: local upload endpoint, streaming temporary file, configured source check, existing importer handoff.
- `tests/browser-import.test.ts`: real importer path, repeat upload, changed record, format and size errors.
- `app/layout.tsx`, `app/globals.css`: metadata and registry styling.
- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`: parser, Node 24 requirement, CLI/tests.
- `.gitignore`, `README.md`: runtime exclusions and documentation.

## Registry identity layer

The registry remains source truth. Commercial operating companies are a separate object; a corporation does not automatically become a commercial company.

Schema additions:

- `registry_profiles`: one derived record per `accounts.id`, normalized legal and alternate names, relaxed discovery names, nine flags, candidate eligibility/reason, rule version, source timestamp, and derivation timestamp. Indexed names and candidate IDs support bounded queries.
- `commercial_companies`: provider namespace plus stable provider company ID (unique together), optional commercial name/domain/industry/description, employee/revenue ranges and counts, reported headquarters, location/subsidiary counts, parent, growth/funding fields, original provider JSON, enrichment and record timestamps. These records are not populated from guessed registry facts.
- `corporation_company_matches`: unique corporation/company pairs with many-to-many relationships, foreign keys, candidate/accepted/rejected/ambiguous status, confidence, explicit name/location/alternate-name evidence, versioned evidence JSON, optional run linkage, and timestamps.
- `enrichment_runs`: one audit row per attempt with provider/version, stable configuration hash, running/completed/failed status, timestamps, counters, and notes. Repeated configurations share a hash, not a run ID.

### Name and flag rules

`lib/resolution/names.ts` lowercases, folds accents/ligatures, removes apostrophes, expands `&` to `and`, normalizes other punctuation/whitespace, and repeatedly removes common trailing English/French legal forms. Both source names remain intact. Interior identity words remain. The strict name keeps Canada (`Shopify Canada Inc.` → `shopify canada`); a separate relaxed hint becomes `shopify`. Relaxed equality alone cannot produce a strong match.

Flags identify obvious numbered names (including Quebec-style hyphenated numbers), professional-corporation phrases, literal holding/investment/management terms and French variants, real-estate terms combined with holding terms, generic legal names, alternate-name presence, and usable Canadian registered location. Capital alone never implies an investment entity. Flags can overlap, are not verified business classifications, and never delete source records.

Candidate preparation excludes only identities with no usable legal **or alternate** name: empty/punctuation-only names, numeric/obvious numbered names, and explicit placeholders. A useful alternate name rescues a numbered corporation. Holding, investment, management, professional, nonprofit, and every industry category remain eligible. Generic-looking named businesses and businesses missing location also remain eligible; these attributes are review metadata. There is no target count or forced 100,000-record limit.

### Backfill and candidate access

```sh
pnpm prepare:registry
pnpm verify:registry 645204
```

The backfill commits batches of 1,000, never loads the complete registry into memory, and skips fresh profiles on rerun. Opening a page creates missing tables only; it never triggers a backfill. CSV inserts/updates write profiles in the same transaction. An unchanged CSV record repairs a missing/outdated profile without changing the source row. Increment `REGISTRY_VERSION` whenever derivation rules change, then rerun preparation. Freshness assumes source writes use the importer, which owns `updated_at`.

`getResolutionCandidates(db, { afterId, limit })` returns at most 5,000 rows per call in corporation-ID order. Continue with the last `corporation_id` until an empty page; the page size is not a universe cap. `registryProfileSummary` exposes candidate/flag counts and missing/stale profiles; helpers exclude stale profiles until refreshed. Complete preparation before starting a future provider run.

### Local matching and idempotent storage

`assessCompanyMatch` compares a supplied pair; it does not scan commercial data or call a provider. Exact normalized identity plus city/province is excellent, exact plus province is strong, and at least 0.90 normalized Levenshtein similarity plus city/province is probable. Name-only evidence and names shorter than three non-space characters are weak. Explicit country/province conflicts prevent a strong classification. Alternate names participate; empty/numbered names do not generate exact-name identity matches. All results start as `candidate`, including excellent matches. Confidence scores represent rule strength, not measured probabilities.

Stored evidence records normalized inputs, rule versions, exact/fuzzy/alternate comparison, city/province equality and conflicts, and separately supplied provider confidence. Registry location is explicitly a **registered address**, not a verified operating HQ.

`upsertCommercialCompany` preserves omitted fields and clears explicitly null fields; provider IDs must be stable, not inferred from names/domains. `upsertCompanyMatch` updates evidence without duplicating pairs or overwriting accepted/rejected/ambiguous decisions. `setMatchStatus` is a separate explicit decision. Run helpers validate counters and produce configuration hashes independent of object-key order. Helpers and isolated tests use synthetic provider identifiers; the real commercial tables remain empty.

### Limitations before connecting a provider

- Accents, punctuation, and legal suffixes can collapse different names. Exact-name equality is evidence, not proof. Neither fuzzy similarity nor matching addresses establish an operating relationship.
- Literal holding/management/investment keywords may describe genuine operating businesses. Generic flags may catch real brands. These flags never exclude named entities; manually review representative samples before introducing prioritization.
- Numbered-name detection intentionally prefers false negatives. Unusual numbered/bilingual forms may remain candidates. Missing registered location is not enough to exclude a usable name.
- Actual-data review retained short names such as `4M` rather than excluding them. City abbreviations such as `D.D.O.` and numbered municipality names such as `100 Mile House` remain usable; obvious postal codes, telephone-only values, and unit-only values do not. The location flag is a plausibility check, not address validation or geocoding.
- A provider adapter must define its stable IDs, provider namespace, field units (especially growth and funding currency), null/partial-update semantics, geographic normalization, and raw-payload provenance. Financial fields are not interpreted yet; preserve currency and units in provider JSON until the chosen contract defines additional fields.
- Raw payload storage keeps the latest supplied company payload, not an immutable history. Run rows track attempts; they are not a queue, retry scheduler, or per-field lineage system. Reassessing a decided match preserves its status, so a future review workflow should surface changed/conflicting evidence.
- Matching is a bounded pairwise helper, not a candidate-retrieval engine. A provider integration must supply plausible pairs; never compare every registry record to every commercial company.

Phase 3 implementation files: `lib/resolution/{names,schema,profiles,matching,store}.ts`, `scripts/{prepare-registry,verify-registry}.ts`, and `tests/resolution.test.ts`. Existing database initialization and CSV import now call the derived layer. The later browser-upload work changes the homepage and directory UI, without changing Phase 3's company-resolution schema.

### Phase 3 full-registry verification — October 2, 2026

All 645,204 corporations have fresh `registry-v3` profiles. Candidate pagination returned all **391,327** eligible records exactly once. A repeated backfill refreshed zero records. The final full CSV re-import repaired profiles for the revised rules while reporting **645,204 unchanged source rows, zero inserts, zero updates, zero invalid rows, and zero duplicate IDs** (53.3 seconds). An earlier fresh-profile re-import took 19.5 seconds.

| Derived flag | Records |
| --- | ---: |
| Numbered corporation | 253,874 |
| Professional corporation | 958 |
| Holding company | 12,657 |
| Investment entity | 6,432 |
| Real-estate holding entity | 117 |
| Management company | 10,805 |
| Generic legal name | 254,038 |
| Alternate name present | 28,529 |
| Useful registered location | 645,190 |

Flags overlap. Numbered/generic identities dominate; 12 numbered corporations remain candidates through a usable alternate name. The initial short-name rule excluded 77 additional records; the audited rule retains them. Only 14 registered locations fail the final plausibility rule, and that flag does not exclude an otherwise usable identity. These 391,327 records are **matching candidates**, not verified commercial companies or Ramp prospects.

Typecheck, production build, all 10 tests (including the original four Phase 2 tests), SQLite/full-text integrity, foreign keys, search, pagination, and source-backed detail checks pass. Representative search timings remain approximately 0.07 ms for a corporation ID and 92.6 ms for Toronto (database queries, not browser latency). The five shared business-number groups remain intact. The database is now 907.5 MiB. The compiled sample page still has eight distinct account links and its sample disclosure. Browser interaction remains unverified under the previously documented browser-security limitation.

Every source column, including original raw JSON, IDs and timestamps, was hashed in ID order before and after this implementation. Both SHA-256 digests are `b7ebc497ca1ccbde502b13edb8bf86b1c5d64be0338fa46684e427ad13147f8e`. All source records remain unchanged. `verify:registry` optionally accepts a baseline JSON path after the expected count, containing `count` and `sha256`, for repeatable comparisons.

At that historical checkpoint, the commercial-company, match, and enrichment-run tables each contained **zero** rows. The later CID integration adds evidence runs and direct corporation evidence without creating commercial-company records or corporation/company pairs.

## Canadian Importers evidence workflow

Government CSV uploads do not run commercial matching. The enabled **Enrich for ICP** button in `/corporations` starts the local Canadian Importers evidence stage and shows streaming progress and results. It stops at evidence publication. Corporation details show the data year, source workbook rows, matching explanation, and file hash. No evidence means unknown, never a negative importer judgment.

### Configuring the local source

The supplied `cid-bdic-majorimportersbycity2024.xls` has been inspected and copied into the ignored `data/` directory. The original Downloads file remains unchanged. Its contents are XLSB despite its `.xls` extension. The adapter recognizes the actual file format and also supports equivalent XLS and XLSX workbooks with the inspected schema.

The browser workflow reads `data/cid-bdic-majorimportersbycity2024.xls` by default. Set `BDR_CANADIAN_IMPORTERS_PATH` and restart the server to use another local copy. The API never accepts an arbitrary path from the browser. This adapter validates the six exact headers, the `pQRY003_CITY` sheet, and year 2024. Other CID schemas or years require an explicitly reviewed adapter.

The command interface is in place:

```sh
pnpm import:evidence canadian-importers /path/to/downloaded-bulk-file
```

CLI and browser use the same adapter and runner. A database-specific lock prevents simultaneous evidence runs. If a process is forcibly killed, its audit may remain running and its `.evidence-import.lock` remains; confirm the process has stopped before manually removing that exact lock file and rerunning. Ordinary failures release the lock and preserve previously published observations.

### Storage and provenance

- `company_evidence` stores source-attributed typed observations against a corporation, commercial company, or both. The stable identity is source + source company key + signal + target; reruns update observations without duplicating them. Explicit false/zero are preserved; null clears the observation. A company need not be invented to attach evidence directly to a confidently matched corporation.
- `evidence_workflows` extends the existing enrichment-run audit with filename, SHA-256, adapter version, stage, counters, and errors. Stages are `source_ready`, `preparing_candidates`, `matching_evidence`, `evidence_ready`, and `failed`; Jev stays `not_run`. Completion means the local evidence phase completed, not ICP evaluation.
- `evidence_source_companies` and `evidence_source_rows` retain identities, source record IDs, physical row numbers, raw source payloads, semantic attributes, and observation dates for each attempt. Reruns retain audit history; they do not duplicate published observations.
- `evidence_identity_matches` records accepted, candidate, ambiguous, and rejected pairs with explainable name/location evidence. `evidence_registry_locations` provides a derived city/province index, refreshed only by explicit evidence preparation. The original registry and existing company-match schemas are preserved.

### Adapter and import contract

`BulkEvidenceAdapter` supplies a source namespace, version, aggregation definitions, and an async iterator over a local file. The adapter must stream where appropriate, establish stable company keys from inspected source semantics, preserve raw records/IDs, and define normalization and deduplication for any semantic attributes. A reused key with conflicting normalized identities fails instead of silently merging companies.

The generic runner hashes the file, stages batches of at most 1,000 rows, prepares candidates, retrieves plausible registry identities, and publishes accepted evidence in one SQLite transaction. The Excel reader decodes this small workbook in memory (20 MiB file / 100,000-row limit); it is not a streaming Excel parser. A failed read or publication leaves prior published evidence intact. The audit records the failed attempt. Run one importer per database at a time.

**Each adapter imports a complete source snapshot.** A successful run retires earlier batch-published observations for that source that are absent from the new snapshot; this removes stale evidence without creating false/zero values. Do not feed arbitrary partial shards as complete snapshots. Raw historical rows remain available for provenance and consume disk space. Empty snapshots are rejected to protect existing evidence.

Counts include physical rows processed, unique source identities, accepted source identities, distinct matched corporations, ambiguous/unmatched identities, probable matches awaiting review, observations created/updated/removed, and elapsed time. Probable matches are a subset of unmatched identities. Configuration hashes include source SHA-256, adapter and normalization/matching versions, and signal definitions. Observation dates are normalized to UTC before selecting the latest date; absent dates stay null.

Generic aggregation supports source presence, physical row count, distinct values, and numeric maximum. This real CID adapter publishes **only `is_importer=true`**. The year 2024 is provenance metadata; no exact observation date is fabricated. Repeated normalized identities produce one presence observation while retaining every original row. These rows are directory listings, not shipments, transaction counts, or spend measures. The synthetic test adapter's richer signals are test fixtures only.

### Matching rules and limits

The batch matcher reuses the existing name, accent, suffix, region, and country normalization and pairwise assessments. It accepts only a unique exact primary/alternate name with province support and no known city/province/country conflict. City plus province provides stronger evidence. Postal equality is recorded when comparable, without treating registered addresses as headquarters. Confidence values are rule strengths, not calibrated probabilities.

Ambiguous identities never attach evidence. Fuzzy similarity plus city/province remains a candidate for future review; weak/name-only matches are rejected. There is no review UI in this phase. Name retrieval uses indexes; fallback fuzzy comparison is restricted to a normalized city/province bucket. Exact retrieval caps at 100 and fallback location retrieval at 1,000; exceeding either produces a review-required ambiguous result instead of an arbitrary accepted match. Fuzzy fallback is only attempted when exact-name retrieval finds nothing. These conservative limits may miss true matches, particularly in large cities or when source locations differ. No full registry-by-source cross product is constructed.

The existing 391,327 candidates are matching candidates, not Ramp prospects. Registry-only numbered identities without a usable alternate name remain outside matching. The CID file includes US-state locations, missing foreign postal codes, name variants, and administrative-looking names. Country stays unknown because the file has no country column; full US-state names remain distinct from Canadian province codes and cannot supply province support.

Implementation: `lib/evidence/{types,schema,store,matching,aggregate,import,workflow}.ts`, `lib/evidence/adapters/canadian-importers.ts`, `scripts/import-evidence.ts`, and `tests/evidence.test.ts`. Database initialization adds the tables; the directory and detail pages read coverage. The upload path never calls the evidence runner.

### Historical evidence-foundation verification — October 4, 2026, before CID connection

- Typecheck and production build pass. All **17 tests** pass, including the original 12 and five evidence tests covering typed values, provenance, idempotence, normalization, exact/alternate/location matches, ambiguity, weak rejection, aggregation, unknowns, failed staging, and rollback after partially attempted publication.
- The complete 103,665,471-byte government file was streamed through the browser upload service in process: **645,204 processed and unchanged; zero inserted, updated, invalid, or duplicate IDs**. Import processing took 18.9 seconds. No HTTP request or external API was made by this validation.
- All **645,204** source rows and fresh registry profiles remain. Candidate pagination verified **391,327** eligible records exactly once; repeated profile preparation changed zero rows. The full source-row checksum remains `b7ebc497ca1ccbde502b13edb8bf86b1c5d64be0338fa46684e427ad13147f8e`, identical to the pre-change baseline.
- SQLite integrity, foreign keys, full-text integrity, representative searches, province filtering, pagination, and source-backed detail queries pass. The built sample page retains eight distinct account links and its fictional-data disclosure. A fresh browser click-through was not performed; the earlier browser-tool limitation still applies.
- The real database contains **zero evidence observations, zero source matches, and zero evidence runs**. Upload did not populate the evidence preparation index. No Canadian Importers statistics or coverage claims are available.
- Isolated synthetic tests use nine observations representing seven source identities: three confidently matched corporations, one ambiguous identity, and three unmatched identities (including one probable match awaiting review), producing ten observations. These numbers describe fixtures only, not the Canadian Importers Database.

## Still not implemented

No Jev, OpenAI, external APIs, real ICP scoring, tiers, archetypes, buyer discovery, emails, current triggers, outreach, authentication, or deployment. No industry, size, headcount, or fit is inferred from names.

No external commercial data provider, company/domain/industry/employee enrichment, archetype classification, or ranked Ramp prospect list. Existing sample scores remain fictional. The app and CLI must use the same database path.

The directory's **Enrich for ICP** action currently runs only Canadian Importers evidence matching. Jev and ICP ranking remain later work. Optional registered-address sharing, corporation age, and filing-recency signals were not added in this phase.
