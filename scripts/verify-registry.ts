import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { openDatabase } from "../lib/db/database.ts";
import { backfillRegistryProfiles, getResolutionCandidates, registryProfileSummary } from "../lib/resolution/profiles.ts";
import { FLAG_NAMES } from "../lib/resolution/names.ts";

const db = openDatabase();
try {
  const summary = registryProfileSummary(db);
  if (process.argv[2]) assert.equal(summary.total, Number(process.argv[2]));
  assert.equal(summary.missing_or_stale, 0, "Run prepare:registry before verifying.");
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(backfillRegistryProfiles(db), 0, "A repeated backfill must be a no-op.");
  let after = 0;
  let candidates = 0;
  while (true) {
    const page = getResolutionCandidates(db, { afterId: after, limit: 5000 });
    if (!page.length) break;
    for (const row of page) {
      assert.ok(Number(row.corporation_id) > after);
      after = Number(row.corporation_id);
      candidates++;
    }
  }
  assert.equal(candidates, summary.candidates, "Candidate pagination must return every eligible row exactly once.");
  const hash = createHash("sha256");
  for (const row of db.prepare("SELECT * FROM accounts ORDER BY id").iterate()) hash.update(JSON.stringify(row) + "\n");
  const sourceHash = hash.digest("hex");
  if (process.argv[3]) {
    const baseline = JSON.parse(readFileSync(process.argv[3], "utf8"));
    assert.equal(summary.total, baseline.count);
    assert.equal(sourceHash, baseline.sha256, "Source rows changed relative to the baseline.");
  }
  const samples = Object.fromEntries(FLAG_NAMES.map(flag => [flag, db.prepare(`SELECT a.legal_name, a.alternate_name
    FROM registry_profiles p JOIN accounts a ON a.id=p.corporation_id WHERE p.${flag}=1 LIMIT 5`).all()]));
  const tableCounts = Object.fromEntries(["commercial_companies", "corporation_company_matches", "enrichment_runs"].map(table =>
    [table, db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n]));
  console.log(JSON.stringify({ ...summary, candidate_pages_verified: candidates, source_sha256: sourceHash,
    source_baseline_verified: Boolean(process.argv[3]), ...tableCounts, flag_samples: samples }, null, 2));
} finally { db.close(); }
