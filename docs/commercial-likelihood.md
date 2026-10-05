# Deterministic commercial-likelihood ranking

This phase prioritizes which already-eligible federal corporations might merit later research. It does **not** verify that a corporation is operating, estimate its size, classify its industry, call Jev, or measure Ramp ICP fit. No candidate is excluded by a score: the full eligible set remains accessible. The default directory still shows all source records in source order; the ranking is an optional view.

## Inputs and scoring rules

The `commercial-likelihood-v1` score is a fixed weighted sum, clamped to 0–100. All 391,327 fresh `registry-v3` candidates receive the same 40-point identity baseline. Each triggered component is saved with its exact signed points, machine-readable reason, and human-readable explanation. Ties are ordered by stable internal corporation ID. The 2026 reference year is frozen in this rule version; changing it requires a new rule version and preparation run.

| Signal | Points | Why |
| --- | ---: | --- |
| Eligible usable identity | +40 | Neutral starting point, not proof of commercial activity |
| Usable legal name | +8 | Stronger direct identity than an alternate-name rescue |
| Confident 2024 Canadian Importers match | +18 | Independent observed commercial presence; absent evidence remains unknown |
| Usable alternate registered name | +6 | Additional identity evidence, not a verified trading name |
| Last annual filing year 2025 or 2026 | +4 | Modest recency cue; not current operating proof |
| Usable Canadian registered city/province | +2 | Better researchability; not an operating headquarters |
| Minimum permitted directors 2–25 | +3 | Weak structural cue; not the actual number of directors |
| Otherwise, maximum permitted directors 2–25 | +1 | Even weaker structural cue |
| Normalized name of 1–3 words / 4 words | +4 / +2 | Compact name shape, after removing legal suffixes |
| Distinctive normalized name of 4–25 characters | +4 | Short and not already flagged generic, holding, or investment |
| Operating/commercial term in name | +3 | Lexical hint only, including technology, logistics, manufacturing, foods, retail, services, or energy |
| Numbered corporation | −22 | Weak legal identity, even when an alternate name keeps it eligible |
| Professional corporation | −11 | Often a professional practice rather than the target operating scale |
| Investment entity | −15 | Likely investment vehicle wording |
| Holding company | −13 | Likely holding-structure wording |
| Real-estate holding wording | −7 | Additional penalty when property and holding cues co-occur |
| Generic legal name | −8 | Weak or generic identity |
| Management wording | −3 | Ambiguous operating signal |
| Street-address-like name | −10 | Possible property/address entity |
| High numeric share in name | −6 | Weak brand identity |
| Narrow first-name + surname + service descriptor pattern | −3 | Conservative personal-service hint, not a broad founder-name penalty |

The labels are **high** at 70+, **medium** at 55–69, and **low** below 55. They are descriptive buckets, not calibrated probabilities. There is no corporate-email field in the local registry, so no email signal is invented. Missing annual filings, location, or importer observations do not cause a negative score.

## Full-data results (October 4, 2026)

All **391,327** eligible candidates were scored. Scores range from **20 to 92**; median **63**, 90th percentile **65**, 95th **66**, and 99th **69**. The score distribution has large ties: **150,376** records score 63, **23,045** score 66, and **9,311** score 69. Therefore an exact top-10,000 or top-20,000 cut would arbitrarily split equal-score groups.

| Rank | Score | Example near rank |
| ---: | ---: | --- |
| 100 | 84 | TIDAL ENERGY MARKETING INC. |
| 1,000 | 74 | Marmon Industrial Water Limited |
| 5,000 | 69 | NEWREST TORONTO CORPORATION |
| 10,000 | 69 | WHITESTREAM DIGITAL INC. |
| 20,000 | 66 | TUSCEx Shared Services Corporation |
| 30,000 | 66 | Blacksmith Technologies Inc. |
| 50,000 | 64 | AI Home Smart Services Ltd. |

These are illustrative names, not manually verified operating businesses. The top 100 is dominated by the importer-positive records. At 5,000 and 10,000, the legal names and alternate names often look researchable, but the ordering inside score 69 has no evidence-based meaning. At 20,000 and 30,000, there are still plausible companies, but score 66 contains a very large and mixed group. The observed samples do **not** establish a sharp quality drop-off or a measured precision rate.

| Score threshold | Candidates retained |
| ---: | ---: |
| ≥75 | 960 |
| ≥70 | 3,060 |
| ≥69 | 12,371 |
| ≥68 | 14,219 |
| ≥67 | 15,305 |
| ≥66 | 38,350 |
| ≥65 | 48,063 |

A provisional **67+ review batch (15,305 corporations)** fits the desired 10K–25K range without splitting a score tie; 68+ would be a smaller 14,219-record batch. This is a suggested later Jev input cutoff, **not encoded in scoring or access**. The sharp jump at 66 is the practical reason to inspect the 67/66 boundary before spending inference budget. The 992 importer-positive distinct corporations remain part of the same universe and receive a positive signal; importer evidence is not required.

## Persistence, freshness, and verification

The derived `commercial_likelihood_scores` table stores score, label, summary, component JSON, source timestamp, importer-presence flag, rule version, and scoring time. `commercial_likelihood_state` records the completed preparation version, candidate count, importer-presence hash, and the latest registry import that actually inserted or updated source rows. New importer evidence or a source-changing registry import makes the ranking unavailable until it is prepared again; an unchanged CSV re-import does not. Opening the app never silently scores the full registry.

From the project root, run:

```sh
pnpm prepare:likelihood
pnpm verify:likelihood data/registry-before-cid.json data/likelihood-validation.json
```

The verifier re-runs all scores, requires **zero changed derived rows**, checks every component sum, complete stable rank traversal, source and ranked search, province filtering, pagination, SQLite/foreign-key/FTS integrity, and SHA-256 checksums of the raw registry, registry profiles, and importer observations. Full-data verification found **645,204 unchanged source rows**, **645,204 unchanged profiles**, and **993 unchanged importer observations**. No registry importer, CID matching threshold, or existing observation was modified for this phase. The latest detailed distribution and cutoff examples are saved locally in `data/likelihood-validation.json`.

The score is deliberately cheap and explainable, but its signals are proxies. Names can mislead, annual filing is not operating proof, and director fields are permitted legal limits. Before treating any cutoff as production quality, manually label a stratified sample around the 67/66 boundary and check precision against an external source.
