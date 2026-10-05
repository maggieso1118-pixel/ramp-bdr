import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../lib/db/database.ts";
import { SOURCE_COLUMNS } from "../lib/corporations/normalize.ts";
import { importCorporations } from "../lib/corporations/import.ts";
import { upsertEvidence, getEvidenceCoverage } from "../lib/evidence/store.ts";
import { prepareEvidenceCandidates, matchSourceIdentity, normalizeSourceIdentity } from "../lib/evidence/matching.ts";
import { importBulkEvidence } from "../lib/evidence/import.ts";
import { canadianImportersAdapter } from "../lib/evidence/adapters/canadian-importers.ts";
import { getEvidenceWorkflow } from "../lib/evidence/workflow.ts";
import type { BulkEvidenceAdapter, BulkEvidenceRow } from "../lib/evidence/types.ts";

// Synthetic observations exercise the generic contract. These are NOT Canadian Importers headers/mappings.
const adapter: BulkEvidenceAdapter = {
  source: "synthetic_import_activity", version: "fixture-v1",
  signals: [{ signal: "is_importer", operation: "presence" }, { signal: "import_record_count", operation: "row_count" },
    { signal: "import_product_category_count", operation: "distinct_count", field: "category" },
    { signal: "import_origin_country_count", operation: "distinct_count", field: "origin" },
    { signal: "import_year_count", operation: "distinct_count", field: "year" },
    { signal: "latest_import_year", operation: "max_number", field: "year" }],
  async *read(path) {
    const stream = createReadStream(path);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try { for await (const line of lines) if (line.trim()) yield JSON.parse(line) as BulkEvidenceRow; }
    finally { lines.close(); stream.destroy(); }
  },
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bdr-evidence-test-"));
  const csv = join(directory, "registry.csv");
  const file = join(directory, "synthetic-public-observations.jsonl");
  const db = openDatabase(join(directory, "registry.sqlite"));
  const records = [
    ["Northstar Industrial Supply Inc.", "", "Toronto", "ON", "M5V 1A1"],
    ["123456 Canada Inc.", "Les Équipements Boréal Ltée", "Montréal", "QC", "H2X 1Y4"],
    ["Harbour Components Inc.", "", "Halifax", "NS", ""],
    ["Harbour Components Ltd.", "", "Halifax", "NS", ""],
    ["Maple Packaging Inc.", "", "Winnipeg", "MB", ""],
    ["Cedar Machinery Corporation", "", "Ottawa", "ON", ""],
    ["Seaside Services Inc.", "", "St. John's", "NF", ""],
  ];
  const rows = records.map(([name, alternate, city, province, postal], index) => SOURCE_COLUMNS.map(column => {
    const values: Record<string,string> = { "Corporation number": String(index + 1), "Corporate name - form 1": name,
      "Corporate name - form 2": alternate, "City/town": city, "Province/territory": province, "Country": "CA", "Postal code": postal };
    return values[column] ?? "";
  }));
  await writeFile(csv, [SOURCE_COLUMNS, ...rows].map(row => row.map(v => `"${v.replaceAll('"','""')}"`).join(",")).join("\n"));
  await importCorporations(db, csv);
  const northstar = { key: "supplier-001", sourceId: "00001", name: "NORTHSTAR INDUSTRIAL SUPPLY LTD.", city: "Toronto", province: "Ontario", country: "Canada", postal: "M5V1A1" };
  const observations: BulkEvidenceRow[] = [
    ...[{ category: "mechanical", origin: "US", year: 2023 }, { category: "electrical", origin: null, year: 2024 }, { category: "mechanical", origin: "US", year: null }]
      .map((attributes, index) => ({ identity: northstar, sourceRecordId: `line-${index}`, raw: { supplier: "00001", ...attributes }, attributes })),
    { identity: { key: "supplier-002", name: "Les Equipements Boreal Inc.", city: "Montreal", province: "Quebec" }, raw: { label: "bilingual" } },
    { identity: { key: "supplier-003", name: "Harbour Components", city: "Halifax", province: "NS" }, raw: { label: "ambiguous" } },
    { identity: { key: "supplier-004", name: "Maple Packaging" }, raw: { label: "name only" } },
    { identity: { key: "supplier-005", name: "Cedar Machinary", city: "Ottawa", province: "ON" }, raw: { label: "typo" } },
    { identity: { key: "supplier-006", name: "Unlisted Export Business", city: "Victoria", province: "BC" }, raw: { label: "unmatched" } },
    { identity: { key: "supplier-007", name: "Seaside Services Ltd.", province: "Newfoundland and Labrador" }, raw: { label: "province only" } },
  ];
  const write = (data: BulkEvidenceRow[]) => writeFile(file, data.map(row => JSON.stringify(row)).join("\n"));
  await write(observations);
  return { db, directory, file, observations, write, close: async () => { db.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("evidence values preserve provenance, idempotency, false/zero and missing-as-unknown", async () => {
  const f = await fixture();
  try {
    const input = { corporationId: 1, source: "test-source", sourceCompanyKey: "source-1", signal: "known_signal", value: true, metadata: { originalId: "00001" } };
    const first = upsertEvidence(f.db, input);
    assert.equal(upsertEvidence(f.db, { ...input, value: false }).id, first.id);
    assert.deepEqual(getEvidenceCoverage(f.db, { corporationId: 1 }).observations[0].value, false);
    assert.equal(JSON.parse(String(f.db.prepare("SELECT metadata_json FROM company_evidence WHERE id=?").get(first.id!)!.metadata_json)).originalId, "00001");
    upsertEvidence(f.db, { ...input, signal: "measured_count", value: 0 });
    assert.ok(getEvidenceCoverage(f.db, { corporationId: 1 }).observations.some(row => row.value === 0));
    assert.equal(upsertEvidence(f.db, { ...input, value: null }).removed, true);
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 2 }).hasEvidence, false);
    assert.deepEqual(getEvidenceCoverage(f.db, { corporationId: 2 }).observations, []);
    assert.throws(() => upsertEvidence(f.db, { ...input, value: NaN }));
    assert.throws(() => upsertEvidence(f.db, { ...input, corporationId: 999 }));
  } finally { await f.close(); }
});

test("source matching uses normalized and alternate names, locations, ambiguity, and weak rejection", async () => {
  const f = await fixture();
  try {
    prepareEvidenceCandidates(f.db);
    const normalized = normalizeSourceIdentity(f.observations[0].identity);
    assert.equal(normalized.name, "northstar industrial supply");
    assert.equal(normalized.province, "ON");
    const exact = matchSourceIdentity(f.db, f.observations[0].identity);
    assert.equal(exact.outcome, "accepted");
    assert.equal(exact.accepted!.explanation.postal_match, true);
    assert.equal(exact.accepted!.explanation.city_match, true);
    const alternate = matchSourceIdentity(f.db, f.observations[3].identity);
    assert.equal(alternate.outcome, "accepted");
    assert.equal(alternate.accepted!.explanation.alternate_name_match, true);
    assert.equal(matchSourceIdentity(f.db, f.observations[4].identity).outcome, "ambiguous");
    const weak = matchSourceIdentity(f.db, f.observations[5].identity);
    assert.equal(weak.outcome, "unmatched");
    assert.equal(weak.matches[0].status, "rejected");
    assert.equal(matchSourceIdentity(f.db, f.observations[6].identity).outcome, "candidate");
    assert.equal(matchSourceIdentity(f.db, f.observations[8].identity).outcome, "accepted");
    assert.equal(matchSourceIdentity(f.db, { ...f.observations[0].identity, city: "Ottawa" }).outcome, "unmatched");
    assert.equal(matchSourceIdentity(f.db, { ...f.observations[0].identity, country: "US" }).outcome, "unmatched");
  } finally { await f.close(); }
});

test("bulk runs aggregate real observations, publish idempotently, retain raw rows and leave government facts intact", async () => {
  const f = await fixture();
  try {
    const before = f.db.prepare("SELECT * FROM accounts ORDER BY id").all();
    const first = await importBulkEvidence(f.db, f.file, adapter);
    assert.deepEqual([first.rowsProcessed,first.uniqueSourceCompanies,first.matchedSourceCompanies,first.matchedCorporations,first.ambiguousMatches,first.unmatchedSourceCompanies,first.probableMatches], [9,7,3,3,1,3,1]);
    assert.equal(first.evidenceCreated, 10);
    assert.equal(first.stage, "evidence_ready");
    assert.equal(first.jevStatus, "not_run");
    const values = Object.fromEntries(getEvidenceCoverage(f.db, { corporationId: 1 }).observations.map(row => [row.signal,row.value]));
    assert.deepEqual(values, { is_importer: true, import_record_count: 3, import_product_category_count: 2,
      import_origin_country_count: 1, import_year_count: 2, latest_import_year: 2024 });
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 2 }).observations.length, 2);
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 3 }).hasEvidence, false);
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 5 }).hasEvidence, false);
    const evidenceIds = f.db.prepare("SELECT id FROM company_evidence ORDER BY id").all();
    const repeat = await importBulkEvidence(f.db, f.file, adapter);
    assert.equal(repeat.evidenceCreated, 0);
    assert.equal(repeat.evidenceUpdated, 10);
    assert.deepEqual(f.db.prepare("SELECT id FROM company_evidence ORDER BY id").all(), evidenceIds);
    assert.deepEqual(f.db.prepare("SELECT * FROM accounts ORDER BY id").all(), before);
    const provenance = f.db.prepare(`SELECT r.raw_json,w.filename,w.file_sha256 FROM company_evidence e
      JOIN evidence_source_rows r ON r.source_company_id=e.source_company_id JOIN evidence_workflows w ON w.run_id=e.run_id
      WHERE e.corporation_id=1 LIMIT 1`).get()!;
    assert.equal(JSON.parse(String(provenance.raw_json)).supplier, "00001");
    assert.equal(provenance.filename, "synthetic-public-observations.jsonl");
    assert.equal(String(provenance.file_sha256).length, 64);
    assert.equal(f.db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("failed runs retain published evidence; successful new snapshots remove stale signals without inventing negatives", async () => {
  const f = await fixture();
  try {
    await importBulkEvidence(f.db, f.file, adapter);
    const before = f.db.prepare("SELECT * FROM company_evidence ORDER BY id").all();
    const broken: BulkEvidenceAdapter = { ...adapter, async *read() {
      for (let i=0;i<1001;i++) yield f.observations[0];
      throw new Error("synthetic read failure");
    } };
    await assert.rejects(importBulkEvidence(f.db, f.file, broken), /synthetic read failure/);
    assert.deepEqual(f.db.prepare("SELECT * FROM company_evidence ORDER BY id").all(), before);
    assert.equal(getEvidenceWorkflow(f.db).latest!.stage, "failed");
    // Fail after some observations have been updated, to verify publication rolls back as a unit.
    f.db.exec(`CREATE TRIGGER fail_evidence_publish BEFORE UPDATE ON company_evidence
      WHEN NEW.signal_type='latest_import_year' BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END`);
    await assert.rejects(importBulkEvidence(f.db, f.file, adapter), /synthetic publication failure/);
    assert.deepEqual(f.db.prepare("SELECT * FROM company_evidence ORDER BY id").all(), before);
    const failed = getEvidenceWorkflow(f.db).latest!;
    assert.equal(failed.stage, "failed");
    assert.equal(JSON.parse(String(failed.report_json)).evidenceUpdated, 0);
    f.db.exec("DROP TRIGGER fail_evidence_publish");
    await f.write([{ ...f.observations[0], attributes: {} }]);
    const revised = await importBulkEvidence(f.db, f.file, adapter);
    assert.equal(revised.evidenceRemoved, 8);
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 1 }).observations.length, 2);
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 2 }).hasEvidence, false);
    await f.write([{ ...f.observations[0] }, { ...f.observations[0], identity: { ...f.observations[0].identity, name: "Conflicting Business" } }]);
    await assert.rejects(importBulkEvidence(f.db, f.file, adapter), /Conflicting identities/);
    assert.equal(getEvidenceCoverage(f.db, { corporationId: 1 }).observations.length, 2);
  } finally { await f.close(); }
});

test("Canadian Importers publishes only presence and keeps Jev disabled", () => {
  const db = openDatabase(":memory:");
  try {
    assert.deepEqual(canadianImportersAdapter().signals, [{ signal: "is_importer", operation: "presence" }]);
    assert.equal(canadianImportersAdapter().metadata!.data_year, 2024);
    assert.equal(getEvidenceWorkflow(db).jevStatus, "not_run");
    assert.equal(getEvidenceWorkflow(db).corporationsWithEvidence, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM enrichment_runs").get()!.n, 0);
  } finally { db.close(); }
});
