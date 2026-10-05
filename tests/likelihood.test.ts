import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../lib/db/database.ts";
import { SOURCE_COLUMNS } from "../lib/corporations/normalize.ts";
import { importCorporations } from "../lib/corporations/import.ts";
import { deriveRegistryIdentity } from "../lib/resolution/names.ts";
import { scoreCommercialLikelihood } from "../lib/likelihood/score.ts";
import { prepareCommercialLikelihood } from "../lib/likelihood/prepare.ts";
import { getCommercialLikelihoodScore, getLikelihoodState, getRankedLikelihoodCandidates } from "../lib/likelihood/queries.ts";
import { searchCorporations } from "../lib/corporations/queries.ts";
import { upsertEvidence } from "../lib/evidence/store.ts";
import { CANADIAN_IMPORTERS_SOURCE } from "../lib/evidence/canadian-importers-config.ts";

function scored(name: string, changes: Partial<Parameters<typeof scoreCommercialLikelihood>[0]> = {}, alternate: string | null = null) {
  return scoreCommercialLikelihood({ ...deriveRegistryIdentity({ legal_name: name, alternate_name: alternate,
    city: "Toronto", province_normalized: "ON", country: "CA" }),
    min_directors: "1", max_directors: "10", last_annual_filing_year: "2025", has_importer_evidence: 0,
    ...changes });
}
const points = (result: ReturnType<typeof scored>, reason: string) => result.signals.find(s => s.reason === reason)?.points ?? 0;

test("named components penalize legal vehicles without hard exclusion", () => {
  const normal = scored("Northstar Software Inc.");
  const numbered = scored("123456 Canada Inc.", {}, "Northstar Software Ltd.");
  assert.equal(points(numbered, "numbered_corporation"), -22);
  assert.ok(numbered.score > 0);
  assert.ok(scored("Northstar Holdings Inc.").score < normal.score);
  assert.equal(points(scored("Northstar Holdings Inc."), "holding_company"), -13);
  assert.equal(points(scored("Northstar Investments Inc."), "investment_entity"), -15);
  assert.equal(points(scored("Northstar Professional Corporation"), "professional_corporation"), -11);
  assert.ok(points(scored("Northstar Real Estate Holdings Inc."), "real_estate_holding") < 0);
  assert.ok(points(scored("123 Maple Street Inc."), "street_address_name") < 0);
  assert.ok(points(scored("ABCD 123456 Inc."), "numeric_heavy_name") < 0);
  assert.equal(points(scored("John Smith Consulting Inc."), "possible_personal_service_name"), -3);
  assert.equal(points(scored("Smith and Sons Inc."), "possible_personal_service_name"), 0);
  assert.equal(points(scored("Johnson Technology Inc."), "possible_personal_service_name"), 0);
});

test("positive evidence, director limits, filing year and name shape have bounded explainable weights", () => {
  const base = scored("Northstar Software Inc.");
  assert.equal(points(base, "compact_name"), 4);
  assert.equal(points(base, "concise_distinctive_name"), 4);
  assert.equal(points(base, "operating_word_in_name"), 3);
  assert.equal(points(base, "recent_annual_filing"), 4);
  assert.equal(points(base, "multiple_directors_allowed"), 1);
  assert.equal(points(base, "useful_registered_location"), 2);
  assert.equal(points(scored("Northstar Software Inc.", { has_importer_evidence: 1 }), "matched_2024_importer"), 18);
  assert.equal(points(scored("Northstar Software Inc.", {}, "Northstar Operating Ltd."), "usable_alternate_name"), 6);
  assert.equal(points(scored("Northstar Software Inc.", { min_directors: "2" }), "minimum_directors_two_or_more"), 3);
  assert.equal(points(scored("Northstar Software Inc.", { max_directors: "999999" }), "multiple_directors_allowed"), 0);
  assert.equal(points(scored("Northstar Software Inc.", { last_annual_filing_year: null }), "recent_annual_filing"), 0);
  assert.equal(points(scored("Northstar Software Inc.", { last_annual_filing_year: "2024" }), "recent_annual_filing"), 0);
  assert.equal(points(scored("Northstar Software Inc.", { last_annual_filing_year: "2027" }), "recent_annual_filing"), 0);
  assert.equal(points(scored("Northstar Software Inc.", { has_useful_location: 0 }), "useful_registered_location"), 0);
  assert.equal(points(scored("Northstar Global Industrial Services Inc."), "four_word_name"), 2);
  assert.deepEqual(scored("Northstar Software Inc."), scored("Northstar Software Inc."));
  assert.equal(base.score, base.signals.reduce((sum, s) => sum + s.points, 0));
});

test("scoring writes only derived rows, ranks ties stably, and repeats without source/evidence changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bdr-likelihood-"));
  const db = openDatabase(join(dir, "data.sqlite"));
  try {
    const csv = join(dir, "corporations.csv");
    const names = ["Northstar Software Inc.", "Northstar Holdings Inc.", "Northstar Investments Inc.",
      "John Smith Consulting Inc.", "123456 Canada Inc.", "Northstar Logistics Inc."];
    const records = names.map((name, i) => SOURCE_COLUMNS.map(column => {
      const values: Record<string, string> = { "Corporation number": String(i + 1), "Corporate name - form 1": name,
        "Corporate name - form 2": i === 4 ? "Northstar Services Ltd." : "", "City/town": "Toronto",
        "Province/territory": "ON", "Country": "CA", "Minimum number of directors": i === 0 ? "2" : "1",
        "Maximum number of directors": "10", "Year of last annual filing": "2025" };
      return values[column] ?? "";
    }));
    await writeFile(csv, [SOURCE_COLUMNS, ...records].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n"));
    await importCorporations(db, csv);
    upsertEvidence(db, { corporationId: 1, source: CANADIAN_IMPORTERS_SOURCE,
      sourceCompanyKey: "listing-one", signal: "is_importer", value: true });
    const beforeAccounts = db.prepare("SELECT * FROM accounts ORDER BY id").all();
    const beforeProfiles = db.prepare("SELECT * FROM registry_profiles ORDER BY corporation_id").all();
    const beforeEvidence = db.prepare("SELECT * FROM company_evidence").all();
    const first = prepareCommercialLikelihood(db);
    assert.equal(first.scored, 6);
    const rows = db.prepare("SELECT * FROM commercial_likelihood_scores ORDER BY corporation_id").all();
    assert.equal(getLikelihoodState(db).ready, true);
    assert.equal(getCommercialLikelihoodScore(db, 1)!.hasImporterEvidence, true);
    assert.equal(getCommercialLikelihoodScore(db, 2)!.hasImporterEvidence, false);
    assert.equal(searchCorporations({ sort: "likelihood" }, db).accounts[0].source_id, "1");
    assert.equal(searchCorporations({ sort: "likelihood", province: "ON" }, db).total, 6);
    const ranked = getRankedLikelihoodCandidates(db, { limit: 2 });
    const next = getRankedLikelihoodCandidates(db, { afterScore: Number(ranked[1].score), afterId: Number(ranked[1].corporation_id) });
    assert.equal(ranked.length + next.length, 6);
    assert.equal(new Set([...ranked, ...next].map(row => row.corporation_id)).size, 6);
    const repeated = prepareCommercialLikelihood(db);
    assert.equal(repeated.scored, 6);
    assert.equal(repeated.changed, 0);
    assert.deepEqual(db.prepare("SELECT * FROM commercial_likelihood_scores ORDER BY corporation_id").all(), rows);
    assert.deepEqual(db.prepare("SELECT * FROM accounts ORDER BY id").all(), beforeAccounts);
    assert.deepEqual(db.prepare("SELECT * FROM registry_profiles ORDER BY corporation_id").all(), beforeProfiles);
    assert.deepEqual(db.prepare("SELECT * FROM company_evidence").all(), beforeEvidence);
    upsertEvidence(db, { corporationId: 2, source: CANADIAN_IMPORTERS_SOURCE,
      sourceCompanyKey: "listing-two", signal: "is_importer", value: true });
    assert.equal(getLikelihoodState(db).ready, false);
    assert.equal(prepareCommercialLikelihood(db).changed, 1);
    assert.equal(getLikelihoodState(db).ready, true);
    assert.equal(getCommercialLikelihoodScore(db, 2)!.hasImporterEvidence, true);
    await importCorporations(db, csv);
    assert.equal(getLikelihoodState(db).ready, true);
    records[1][SOURCE_COLUMNS.indexOf("Corporate name - form 1")] = "Northstar Holding Group Inc.";
    await writeFile(csv, [SOURCE_COLUMNS, ...records].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n"));
    await importCorporations(db, csv);
    assert.equal(getLikelihoodState(db).ready, false);
    assert.equal(prepareCommercialLikelihood(db).changed, 1);
    assert.equal(getLikelihoodState(db).ready, true);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
