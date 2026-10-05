import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { openDatabase } from "../lib/db/database.ts";
import { prepareCommercialLikelihood, importerPresenceHash } from "../lib/likelihood/prepare.ts";
import { getLikelihoodState, getRankedLikelihoodCandidates } from "../lib/likelihood/queries.ts";
import { searchCorporations } from "../lib/corporations/queries.ts";
import { LIKELIHOOD_VERSION } from "../lib/likelihood/score.ts";
import { REGISTRY_VERSION } from "../lib/resolution/names.ts";

const [baselinePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !outputPath) throw new Error("Usage: pnpm verify:likelihood BASELINE_JSON OUTPUT_JSON");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const db = openDatabase();

function hashRows(sql: string) {
  const hash = createHash("sha256");
  let count = 0;
  for (const row of db.prepare(sql).iterate()) { hash.update(JSON.stringify(row) + "\n"); count++; }
  return { count, sha256: hash.digest("hex") };
}

try {
  const evidenceBefore = hashRows("SELECT * FROM company_evidence ORDER BY id");
  const sourceBefore = hashRows("SELECT * FROM accounts ORDER BY id");
  const profilesBefore = hashRows("SELECT * FROM registry_profiles ORDER BY corporation_id");
  assert.equal(sourceBefore.count, baseline.count);
  assert.equal(sourceBefore.sha256, baseline.sha256);
  assert.equal(evidenceBefore.count, 993);
  assert.equal(db.prepare("SELECT count(*) n FROM commercial_likelihood_scores").get()!.n, baseline.candidates);
  assert.equal(getLikelihoodState(db).ready, true);
  const scoreBefore = hashRows("SELECT * FROM commercial_likelihood_scores ORDER BY corporation_id");
  console.log("Baseline verified; repeating deterministic scoring…");
  const repeat = prepareCommercialLikelihood(db);
  assert.equal(repeat.scored, baseline.candidates);
  assert.equal(repeat.changed, 0);
  assert.equal(repeat.removed, 0);
  assert.deepEqual(hashRows("SELECT * FROM commercial_likelihood_scores ORDER BY corporation_id"), scoreBefore);
  assert.deepEqual(hashRows("SELECT * FROM accounts ORDER BY id"), sourceBefore);
  assert.deepEqual(hashRows("SELECT * FROM registry_profiles ORDER BY corporation_id"), profilesBefore);
  assert.deepEqual(hashRows("SELECT * FROM company_evidence ORDER BY id"), evidenceBefore);
  assert.equal(importerPresenceHash(db), repeat.evidenceHash);
  assert.equal(db.prepare("SELECT count(*) n FROM registry_profiles WHERE version=? AND is_candidate=1").get(REGISTRY_VERSION)!.n, baseline.candidates);
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.exec("INSERT INTO accounts_search(accounts_search, rank) VALUES ('integrity-check', 1)");
  const query = searchCorporations({ query: "Toronto" }, db);
  assert.ok(query.total > 0);
  const province = searchCorporations({ province: "ON", sort: "likelihood" }, db);
  const provincePage2 = searchCorporations({ province: "ON", sort: "likelihood", page: 2 }, db);
  assert.ok(province.accounts.length === 25 && provincePage2.accounts.length === 25);
  assert.ok([...province.accounts, ...provincePage2.accounts].every(a => a.province_normalized === "ON"));
  assert.equal(new Set([...province.accounts, ...provincePage2.accounts].map(a => a.id)).size, 50);
  const rankedQuery = searchCorporations({ query: "shop", sort: "likelihood" }, db);
  assert.ok(rankedQuery.total > 0 && rankedQuery.accounts.every(a => a.likelihood_score !== undefined));

  // Independent keyset pass validates complete ordered access for the next phase.
  let afterScore = 101, afterId = 0, candidatesSeen = 0, lastScore = 101;
  while (true) {
    const page = getRankedLikelihoodCandidates(db, { afterScore, afterId, limit: 5000 });
    if (!page.length) break;
    for (const row of page) {
      const score = Number(row.score), id = Number(row.corporation_id);
      assert.ok(score < lastScore || (score === lastScore && id > afterId));
      lastScore = score; afterId = id; candidatesSeen++;
    }
    afterScore = lastScore;
  }
  assert.equal(candidatesSeen, baseline.candidates);

  const scores = db.prepare("SELECT score,count(*) n FROM commercial_likelihood_scores WHERE version=? GROUP BY score ORDER BY score DESC").all(LIKELIHOOD_VERSION);
  const countAbove = (threshold: number) => scores.reduce((n, row) => n + (Number(row.score) >= threshold ? Number(row.n) : 0), 0);
  const rankAt = db.prepare(`SELECT s.score,s.corporation_id,a.source_id,a.legal_name,a.alternate_name,s.summary
    FROM commercial_likelihood_scores s JOIN accounts a ON a.id=s.corporation_id
    ORDER BY s.score DESC,s.corporation_id ASC LIMIT 1 OFFSET ?`);
  const nearby = db.prepare(`SELECT s.score,a.source_id,a.legal_name,a.alternate_name,s.summary
    FROM commercial_likelihood_scores s JOIN accounts a ON a.id=s.corporation_id
    ORDER BY s.score DESC,s.corporation_id ASC LIMIT 5 OFFSET ?`);
  const rankExamples = [100, 1000, 5000, 10000, 20000, 30000, 50000].map(rank => {
    const boundary = rankAt.get(rank - 1)!;
    return { rank, score: Number(boundary.score), tiedAtScore: Number(db.prepare("SELECT count(*) n FROM commercial_likelihood_scores WHERE score=?").get(boundary.score)!.n),
      around: nearby.all(Math.max(0, rank - 3)) };
  });
  const percentile = (fraction: number) => {
    const offset = Math.floor((baseline.candidates - 1) * (1 - fraction));
    return Number(rankAt.get(offset)!.score);
  };
  const distribution = Object.fromEntries(scores.map(row => [String(row.score), Number(row.n)]));
  const thresholds = Object.fromEntries([75, 70, 69, 68, 67, 66, 65, 60, 55, 50].map(n => [`at_least_${n}`, countAbove(n)]));
  const percentiles = Object.fromEntries([0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]
    .map(n => [`p${Math.round(n * 100)}`, percentile(n)]));
  const components = db.prepare("SELECT signals_json,score FROM commercial_likelihood_scores").iterate();
  for (const row of components) {
    const detail = JSON.parse(String(row.signals_json));
    assert.equal(detail.raw, detail.signals.reduce((sum: number, signal: { points: number }) => sum + signal.points, 0));
    assert.equal(row.score, Math.max(0, Math.min(100, detail.raw)));
  }
  const importerScore = db.prepare(`SELECT count(*) n,min(score) low,max(score) high,avg(score) mean
    FROM commercial_likelihood_scores WHERE has_importer_evidence=1`).get()!;
  const result = { verifiedAt: new Date().toISOString(), scoreVersion: LIKELIHOOD_VERSION,
    scored: scoreBefore.count, repeatedRun: repeat, sourceRows: sourceBefore, profiles: profilesBefore,
    evidenceRows: evidenceBefore, thresholds, percentiles, distribution, rankExamples, importerScore,
    checks: { sourceUnchanged: true, profilesUnchanged: true, importerEvidenceUnchanged: true,
      scoresDeterministic: true, rankedKeysetCount: candidatesSeen, scoreComponentsReconciled: true,
      sqliteIntegrity: true, foreignKeys: true, ftsIntegrity: true, sourceSearch: query.total,
      rankedSearch: rankedQuery.total, provinceFiltering: true, rankedPagination: true } };
  writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, distribution: "Saved in output JSON", rankExamples: result.rankExamples.map(({ rank, score, tiedAtScore }) => ({ rank, score, tiedAtScore })) }, null, 2));
} finally { db.close(); }
