import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../lib/db/database.ts";
import { SOURCE_COLUMNS } from "../lib/corporations/normalize.ts";
import { importCorporations } from "../lib/corporations/import.ts";
import { normalizeCompanyName, relaxedCompanyName, deriveRegistryIdentity, REGISTRY_VERSION } from "../lib/resolution/names.ts";
import { backfillRegistryProfiles, getResolutionCandidates, registryProfileSummary } from "../lib/resolution/profiles.ts";
import { assessCompanyMatch, nameSimilarity } from "../lib/resolution/matching.ts";
import { upsertCommercialCompany, upsertCompanyMatch, setMatchStatus, startEnrichmentRun, finishEnrichmentRun, enrichmentConfigHash } from "../lib/resolution/store.ts";

test("name normalization preserves identity, handles accents/legal forms, and is idempotent", () => {
  const cases = [
    ["8448566 CANADA INC.", "8448566 canada"], ["Shopify Canada Inc.", "shopify canada"],
    ["ACME TECHNOLOGIES, LTD.", "acme technologies"], ["Gestion Example Inc.", "gestion example"],
    ["Example Holdings Inc.", "example holdings"], ["Example Professional Corporation", "example professional"],
    ["  Société   Énergie  LTÉE. ", "societe energie"], ["Cœur & D’Art Incorporated", "coeur and dart"],
    ["Acme Inc. / Ltd.", "acme"], ["Limited Edition Inc.", "limited edition"], ["A.B. Technologies", "a b technologies"],
    ["", ""], ["Inc.", ""],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeCompanyName(input), expected);
    assert.equal(normalizeCompanyName(normalizeCompanyName(input)), expected);
  }
  assert.equal(relaxedCompanyName("Shopify Canada Inc."), "shopify");
  assert.equal(relaxedCompanyName("8448566 Canada Inc."), "8448566 canada");
  assert.equal(normalizeCompanyName("Canada Goose Inc."), "canada goose");
});

test("flags are metadata and preserve named entities of every category", () => {
  const derive = (legal_name: string, alternate_name: string | null = null) => deriveRegistryIdentity({ legal_name, alternate_name, city: "Toronto", province_normalized: "ON", country: "CA" });
  assert.equal(derive("8448566 CANADA INC.").is_numbered_corporation, true);
  assert.equal(derive("8448566 CANADA INC.").is_candidate, false);
  assert.equal(derive("1234-5678 Québec Inc.").is_numbered_corporation, true);
  assert.equal(derive("1234567 B.C. Ltd.").is_numbered_corporation, true);
  assert.equal(derive("8448566 CANADA INC.", "Énergie Nouvelle Ltée").is_candidate, true);
  assert.equal(derive("8448566 CANADA INC.", "123456 Canada Ltd.").is_candidate, false);
  assert.equal(derive("123 Studios Inc.").is_numbered_corporation, false);
  assert.equal(derive("4M Corp. Inc.").is_candidate, true);
  assert.equal(derive("A Inc.").is_candidate, true);
  assert.equal(derive("Example Holdings Inc.").is_holding_company, true);
  assert.equal(derive("Example Professional Corporation").is_professional_corporation, true);
  assert.equal(derive("Example Prof. Corp.").is_professional_corporation, true);
  assert.equal(derive("Gestion Example Inc.").is_management_company, true);
  assert.equal(derive("Example Real Estate Holdings Inc.").is_real_estate_holding_entity, true);
  assert.equal(derive("Example Real Estate Services").is_real_estate_holding_entity, false);
  assert.equal(derive("MINDANGLER CAPITAL INC.").is_investment_entity, false);
  assert.equal(derive("Capital City Plumbing Inc.").is_investment_entity, false);
  assert.equal(derive("Example Investments Inc.").is_investment_entity, true);
  assert.equal(derive("Company Inc.").is_generic_legal_name, true);
  assert.equal(derive("Northstar Technologies Inc.").is_generic_legal_name, false);
  for (const name of ["Example Holdings", "Example Professional Corporation", "Example Investments", "Community Nonprofit", "City Hospital", "Example School", "City Construction", "Canada Services", "A.B. Inc."]) assert.equal(derive(name).is_candidate, true, name);
  for (const name of ["", "...", "12345", "N/A", "Unknown"]) assert.equal(derive(name).is_candidate, false, name);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: null }).is_candidate, true);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: "N/A", province_normalized: "ON" }).has_useful_location, false);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: "St. John's", province_normalized: "NF" }).has_useful_location, true);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: "D.D.O.", province_normalized: "QC" }).has_useful_location, true);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: "L7C 2M5", province_normalized: "ON" }).has_useful_location, false);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: "100 Mile House", province_normalized: "BC" }).has_useful_location, true);
  assert.equal(deriveRegistryIdentity({ legal_name: "Named Company", city: "Unit 26", province_normalized: "ON" }).has_useful_location, false);
});

test("matching explains exact, alternate, fuzzy and weak suggestions without accepting them", () => {
  const registry = { legal_name: "Northstar Technologies Inc.", city: "Montréal", province_normalized: "QC", country: "CA" };
  const company = { name: "Northstar Technologies Ltd.", hq_city: "Montreal", hq_region: "Quebec", hq_country: "Canada" };
  const excellent = assessCompanyMatch(registry, company, 0.8);
  assert.equal(excellent.evidence.strength, "excellent");
  assert.equal(excellent.match_status, "candidate");
  assert.equal(excellent.provider_confidence, 0.8);
  assert.equal(assessCompanyMatch(registry, { ...company, hq_city: null }).evidence.strength, "strong");
  assert.equal(assessCompanyMatch(registry, { ...company, name: "Northstar Technologes" }).evidence.strength, "probable");
  assert.equal(assessCompanyMatch(registry, { name: company.name }).evidence.strength, "weak");
  assert.equal(assessCompanyMatch(registry, { ...company, hq_country: "US" }).location_match, "conflict");
  assert.equal(assessCompanyMatch(registry, { ...company, hq_region: "ON" }).evidence.strength, "weak");
  assert.equal(assessCompanyMatch({ legal_name: "Shopify Canada Inc.", city: "Toronto", province_normalized: "ON" }, { name: "Shopify", hq_city: "Toronto", hq_region: "ON" }).evidence.strength, "weak");
  const alternate = assessCompanyMatch({ ...registry, legal_name: "123456 Canada Inc.", alternate_name: "Northstar Technologies" }, company);
  assert.equal(alternate.alternate_name_match, true);
  assert.equal(alternate.exact_name_match, true);
  assert.equal(assessCompanyMatch({ legal_name: "123456 Canada Inc." }, { name: "123456 Canada Inc." }).name_similarity, 0);
  assert.equal(assessCompanyMatch({ legal_name: "Example", city: "Unknown", province_normalized: "Unknown" }, { name: "Example", hq_city: "Unknown", hq_region: "Unknown" }).evidence.strength, "weak");
  assert.equal(nameSimilarity("", ""), 0);
  assert.equal(assessCompanyMatch({ legal_name: "4M Inc.", city: "Toronto", province_normalized: "ON" }, { name: "4M", hq_city: "Toronto", hq_region: "ON" }).evidence.strength, "weak");
  assert.equal(nameSimilarity("abc", "xyz"), 0);
  assert.throws(() => assessCompanyMatch(registry, company, 2));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bdr-resolution-"));
  const file = join(directory, "source.csv");
  const db = openDatabase(join(directory, "test.sqlite"));
  async function write(names: string[]) {
    const records = names.map((name, i) => SOURCE_COLUMNS.map(column => column === "Corporation number" ? String(i + 1) : column === "Corporate name - form 1" ? name : column === "City/town" ? "Toronto" : column === "Province/territory" ? "ON" : ""));
    await writeFile(file, [[...SOURCE_COLUMNS], ...records].map(row => row.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n"));
  }
  await write(["First Company Inc.", "Second Holdings Inc.", "123456 Canada Inc."]);
  await importCorporations(db, file);
  return { db, file, write, close: async () => { db.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("profiles backfill safely, repair stale unchanged rows and follow changed source rows atomically", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    const before = db.prepare("SELECT * FROM accounts ORDER BY id").all();
    assert.equal(registryProfileSummary(db).profiles, 3);
    assert.equal(getResolutionCandidates(db, { limit: 1 })[0].corporation_id, 1);
    assert.equal(getResolutionCandidates(db, { limit: 1, afterId: 1 })[0].corporation_id, 2);
    assert.equal(getResolutionCandidates(db, { afterId: 2 }).length, 0);
    db.exec("DELETE FROM registry_profiles; UPDATE accounts SET updated_at=updated_at");
    assert.equal(registryProfileSummary(db).missing_or_stale, 3);
    assert.equal(backfillRegistryProfiles(db, { batchSize: 1 }), 3);
    const profiles = db.prepare("SELECT * FROM registry_profiles").all();
    assert.equal(backfillRegistryProfiles(db), 0);
    assert.deepEqual(db.prepare("SELECT * FROM registry_profiles").all(), profiles);
    assert.deepEqual(db.prepare("SELECT * FROM accounts ORDER BY id").all(), before);
    db.exec("UPDATE registry_profiles SET version='old' WHERE corporation_id=1; DELETE FROM registry_profiles WHERE corporation_id=2");
    assert.equal(getResolutionCandidates(db).length, 0);
    const unchanged = await importCorporations(db, f.file);
    assert.equal(unchanged.skipped_existing, 3);
    assert.equal(registryProfileSummary(db).missing_or_stale, 0);
    assert.equal(db.prepare("SELECT version FROM registry_profiles WHERE corporation_id=1").get()!.version, REGISTRY_VERSION);
    await f.write(["Renamed Investments Inc.", "Second Holdings Inc.", "123456 Canada Inc."]);
    await importCorporations(db, f.file);
    assert.equal(db.prepare("SELECT normalized_legal_name FROM registry_profiles WHERE corporation_id=1").get()!.normalized_legal_name, "renamed investments");
    const saved = db.prepare("SELECT * FROM accounts WHERE id=1").get();
    db.exec("CREATE TRIGGER fail_profile BEFORE UPDATE ON registry_profiles BEGIN SELECT RAISE(ABORT, 'test profile failure'); END");
    await f.write(["Fail Change Inc."]);
    await assert.rejects(importCorporations(db, f.file), /test profile failure/);
    assert.deepEqual(db.prepare("SELECT * FROM accounts WHERE id=1").get(), saved);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  } finally { await f.close(); }
});

test("provider upserts and explainable many-to-many matches are idempotent; decisions survive reruns", async () => {
  const f = await fixture();
  const { db } = f;
  try {
    const id = upsertCommercialCompany(db, { provider: "test", provider_company_id: "001", name: "First Company Inc.", domain: "example.test", raw_json: '{"original":true}' });
    assert.equal(upsertCommercialCompany(db, { provider: "test", provider_company_id: "001", name: "First Company Ltd." }), id);
    assert.equal(db.prepare("SELECT domain FROM commercial_companies WHERE id=?").get(id)!.domain, "example.test");
    assert.equal(db.prepare("SELECT count(*) n FROM commercial_companies").get()!.n, 1);
    assert.throws(() => upsertCommercialCompany(db, { provider: "test", provider_company_id: " " }));
    assert.throws(() => upsertCommercialCompany(db, { provider: "test", provider_company_id: "bad", raw_json: "not json" }));
    assert.throws(() => db.prepare("INSERT INTO commercial_companies(provider,provider_company_id,created_at,updated_at) VALUES('test','001','','')").run());
    const second = upsertCommercialCompany(db, { provider: "test", provider_company_id: "002" });
    assert.notEqual(upsertCommercialCompany(db, { provider: "another-test", provider_company_id: "001" }), id);
    const assessment = assessCompanyMatch({ legal_name: "First Company Inc." }, { name: "First Company" });
    const match = upsertCompanyMatch(db, 1, id, assessment);
    upsertCompanyMatch(db, 2, id, assessment);
    upsertCompanyMatch(db, 1, second, assessment);
    assert.equal(db.prepare("SELECT count(*) n FROM corporation_company_matches").get()!.n, 3);
    for (const status of ["accepted", "rejected", "ambiguous"] as const) {
      setMatchStatus(db, match, status);
      assert.equal(upsertCompanyMatch(db, 1, id, assessment), match);
      assert.equal(db.prepare("SELECT match_status FROM corporation_company_matches WHERE id=?").get(match)!.match_status, status);
    }
    assert.throws(() => db.prepare("UPDATE corporation_company_matches SET match_status='anything'").run());
    assert.throws(() => upsertCompanyMatch(db, 999, id, assessment));
    const stored = db.prepare("SELECT * FROM corporation_company_matches WHERE id=?").get(match)!;
    assert.equal(JSON.parse(String(stored.evidence_json)).strength, "weak");
    assert.equal(stored.exact_name_match, 1);
  } finally { await f.close(); }
});

test("enrichment attempts preserve reproducible configuration hashes and validated counters", () => {
  const db = openDatabase(":memory:");
  try {
    const config = { limit: 20, filters: { country: "CA", active: true } };
    assert.equal(enrichmentConfigHash(config), enrichmentConfigHash({ filters: { active: true, country: "CA" }, limit: 20 }));
    const a = startEnrichmentRun(db, "test", "v1", config);
    const b = startEnrichmentRun(db, "test", "v1", config);
    assert.notEqual(a, b);
    assert.equal(db.prepare("SELECT count(DISTINCT config_hash) n FROM enrichment_runs").get()!.n, 1);
    assert.throws(() => finishEnrichmentRun(db, a, { status: "completed", processed: 1, created: 2, updated: 0, failed: 0 }));
    finishEnrichmentRun(db, a, { status: "completed", processed: 3, created: 1, updated: 1, failed: 0 });
    finishEnrichmentRun(db, b, { status: "failed", processed: 1, created: 0, updated: 0, failed: 1, notes: "test failure" });
    assert.throws(() => finishEnrichmentRun(db, a, { status: "completed", processed: 0, created: 0, updated: 0, failed: 0 }));
    assert.equal(db.prepare("SELECT status FROM enrichment_runs WHERE id=?").get(b)!.status, "failed");
  } finally { db.close(); }
});
