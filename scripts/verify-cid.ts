import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../lib/db/database.ts";
import { getCorporation, searchCorporations } from "../lib/corporations/queries.ts";
import { registryProfileSummary, getResolutionCandidates, backfillRegistryProfiles } from "../lib/resolution/profiles.ts";
import { importBulkEvidence } from "../lib/evidence/import.ts";
import { canadianImportersAdapter } from "../lib/evidence/adapters/canadian-importers.ts";
import { CANADIAN_IMPORTERS_SOURCE } from "../lib/evidence/canadian-importers-config.ts";
import { getEvidenceCoverage } from "../lib/evidence/store.ts";

const [source, baselinePath, outputPath] = process.argv.slice(2);
if (!source || !baselinePath || !outputPath) throw new Error("Usage: pnpm verify:cid SOURCE BASELINE_JSON OUTPUT_JSON (reruns CID matching)");
const db = openDatabase();
try {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const snapshot = () => db.prepare(`SELECT id,corporation_id,source,source_company_key,signal_type,value_boolean,created_at
    FROM company_evidence WHERE source=? ORDER BY id`).all(CANADIAN_IMPORTERS_SOURCE);
  const before = snapshot();
  assert.ok(before.length > 0, "Complete the first CID import before verifying its repeat run.");
  const first = db.prepare("SELECT * FROM evidence_workflows WHERE source=? AND stage='evidence_ready' ORDER BY run_id LIMIT 1").get(CANADIAN_IMPORTERS_SOURCE)!;
  let lastCount = -1000;
  const repeat = await importBulkEvidence(db, source, canadianImportersAdapter(), report => {
    const done = report.matchedSourceCompanies + report.unmatchedSourceCompanies + report.ambiguousMatches;
    if (done - lastCount >= 1000) { console.log(`${report.stage}: ${done}/${report.uniqueSourceCompanies} identities`); lastCount = done; }
  });
  assert.deepEqual(snapshot(), before, "Repeated import must preserve observation identities, values, IDs and creation times.");
  assert.equal(repeat.evidenceCreated, 0);
  assert.equal(repeat.evidenceUpdated, before.length);
  assert.equal(repeat.evidenceRemoved, 0);
  const firstReport = JSON.parse(String(first.report_json));
  for (const key of ["rowsProcessed", "uniqueSourceCompanies", "matchedSourceCompanies", "matchedCorporations", "ambiguousMatches", "probableMatches", "unmatchedSourceCompanies"] as const) {
    assert.equal(repeat[key], firstReport[key], `Repeat changed ${key}`);
  }
  console.log("Repeat publication verified. Checking source checksum and registry integrity…");
  const hash = createHash("sha256");
  let count = 0;
  for (const row of db.prepare("SELECT * FROM accounts ORDER BY id").iterate()) { hash.update(JSON.stringify(row) + "\n"); count++; }
  const checksum = hash.digest("hex");
  assert.equal(count, baseline.count);
  assert.equal(checksum, baseline.sha256);
  const summary = registryProfileSummary(db);
  assert.equal(summary.missing_or_stale, 0);
  assert.equal(summary.candidates, baseline.candidates);
  assert.equal(backfillRegistryProfiles(db), 0);
  let after = 0, candidates = 0;
  for (;;) {
    const rows = getResolutionCandidates(db, { afterId: after, limit: 5000 });
    if (!rows.length) break;
    for (const row of rows) { assert.ok(Number(row.corporation_id) > after); after = Number(row.corporation_id); candidates++; }
  }
  assert.equal(candidates, baseline.candidates);
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.exec("INSERT INTO accounts_search(accounts_search, rank) VALUES ('integrity-check', 1)");
  const queries = ["8660115", "MINDANGLER", "Toronto", "Vancouver", "shop"].map(query => {
    const result = searchCorporations({ query }, db);
    assert.ok(result.total > 0); assert.ok(result.accounts.length <= 25);
    return { query, total: result.total };
  });
  const firstPage = searchCorporations({ province: "ON" }, db);
  const secondPage = searchCorporations({ province: "ON", page: 2 }, db);
  assert.equal(firstPage.accounts.length, 25); assert.equal(secondPage.accounts.length, 25);
  assert.ok([...firstPage.accounts, ...secondPage.accounts].every(a => a.province_normalized === "ON"));
  assert.equal(new Set([...firstPage.accounts, ...secondPage.accounts].map(a => a.id)).size, 50);
  for (const row of db.prepare(`SELECT a.source_id,a.id FROM accounts a JOIN company_evidence e ON e.corporation_id=a.id
    WHERE e.source=? LIMIT 10`).all(CANADIAN_IMPORTERS_SOURCE)) {
    assert.ok(getCorporation(String(row.source_id), db));
    const detail = getEvidenceCoverage(db, { corporationId: Number(row.id) });
    assert.ok(detail.hasEvidence);
    for (const observation of detail.observations) {
      assert.equal(observation.signal, "is_importer"); assert.equal(observation.value, true);
      assert.equal(observation.metadata.data_year, 2024); assert.equal(observation.observedAt, null);
      assert.ok(observation.sourceRows.length > 0);
    }
  }
  const unsafe = db.prepare(`SELECT count(*) n FROM evidence_identity_matches m JOIN evidence_source_companies c ON c.id=m.source_company_id
    WHERE c.run_id=? AND m.match_status='accepted' AND (m.match_method!='exact_normalized_name'
    OR json_extract(m.evidence_json,'$.province_match')!=1 OR json_extract(m.evidence_json,'$.city_conflict')=1
    OR json_extract(m.evidence_json,'$.province_conflict')=1 OR json_extract(m.evidence_json,'$.country_conflict')=1
    OR json_extract(m.evidence_json,'$.retrieval_truncated')=1)`).get(repeat.runId)!;
  assert.equal(unsafe.n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM company_evidence WHERE source=? AND (signal_type!='is_importer' OR value_boolean!=1)").get(CANADIAN_IMPORTERS_SOURCE)!.n, 0);
  const outcomes = db.prepare("SELECT outcome,outcome_reason,count(*) identities FROM evidence_source_companies WHERE run_id=? GROUP BY outcome,outcome_reason").all(repeat.runId);
  const duplicateGroups = db.prepare(`SELECT count(*) groups,coalesce(sum(n-1),0) repeated_rows FROM
    (SELECT count(*) n FROM evidence_source_rows r JOIN evidence_source_companies c ON c.id=r.source_company_id
      WHERE c.run_id=? GROUP BY c.id HAVING count(*)>1)`).get(repeat.runId);
  const matchEvidence = db.prepare(`SELECT json_extract(m.evidence_json,'$.strength') strength,
    sum(json_extract(m.evidence_json,'$.alternate_name_match')) alternate_names,
    sum(json_extract(m.evidence_json,'$.postal_match')=1) equal_postal_codes,count(*) matches
    FROM evidence_identity_matches m JOIN evidence_source_companies c ON c.id=m.source_company_id
    WHERE c.run_id=? AND m.match_status='accepted' GROUP BY strength`).all(repeat.runId);
  const result = { verifiedAt: new Date().toISOString(), source: resolve(source),
    sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"), firstImport: firstReport, repeatImport: repeat,
    unchangedRegistry: { count, sha256: checksum }, candidateCount: candidates, outcomes, duplicateGroups, matchEvidence,
    checks: { idempotence: "passed", registryChecksum: "passed", sqliteIntegrity: "passed", foreignKeys: "passed", ftsIntegrity: "passed",
      search: queries, provinceFiltering: "passed", pagination: "passed", detailData: "passed", acceptanceRules: "passed" },
    browserVisualVerification: "Blocked: administrator-enforced browser security check unavailable." };
  writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally { db.close(); }
