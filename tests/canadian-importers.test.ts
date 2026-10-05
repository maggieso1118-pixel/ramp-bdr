import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { utils, write } from "xlsx";
import { canadianImportersAdapter, CID_HEADERS, CID_SHEET } from "../lib/evidence/adapters/canadian-importers.ts";
import { openDatabase } from "../lib/db/database.ts";
import { SOURCE_COLUMNS } from "../lib/corporations/normalize.ts";
import { importCorporations } from "../lib/corporations/import.ts";
import { importBulkEvidence } from "../lib/evidence/import.ts";
import { withEvidenceImportLock } from "../lib/evidence/lock.ts";
import { getEvidenceCoverage } from "../lib/evidence/store.ts";
import { POST } from "../app/api/evidence/import/route.ts";

type Cells = (string | number | null)[][];
async function workbook(path: string, rows: Cells, format: "xlsb" | "xlsx" | "biff8" = "xlsb", headers: readonly string[] = CID_HEADERS) {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet([[...headers], ...rows]), CID_SHEET);
  await writeFile(path, write(book, { type: "buffer", bookType: format }));
}
const sourceRows: Cells = [
  ["Montréal", "Équipements Boréal Ltd.", "Quebec", "Québec", "H2X 1Y4", 2024],
  ["Montreal", "Equipements Boreal Inc.", "Quebec", "Québec", "H2X1Y4", 2024],
  ["Ottawa", "Cedar Machinery", "Ontario", "Ontario", "K1A 0B1", 2024],
  ["Toronto", "Cedar Machinery", "Ontario", "Ontario", "M5V 1A1", 2024],
  ["Ottawa", "Cedar Machinary", "Ontario", "Ontario", "K1A 0B1", 2024],
  ["Halifax", "Harbour Components", "Nova Scotia", "Nouvelle-Écosse", "B3H 1A1", 2024],
  ["Ottawa", "Cedar Machinery", "New York", "New York", null, 2024],
  ["Unknown City", "Unlisted Company", "Ontario", "Ontario", null, 2024],
];

test("CID detects XLSB behind .xls, also reads XLS/XLSX, and preserves rows and stable location identities", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cid-reader-"));
  try {
    const path = join(dir, "source.xls");
    for (const format of ["xlsb", "xlsx", "biff8"] as const) {
      await workbook(path, [sourceRows[0], [], sourceRows[1], sourceRows[3]], format);
      const rows = await Array.fromAsync(canadianImportersAdapter().read(path));
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(r => r.sourceRowNumber), [2, 4, 5]);
      assert.equal(rows[0].identity.key, rows[1].identity.key);
      assert.notEqual(rows[0].identity.key, rows[2].identity.key);
      assert.equal(rows[0].raw["COMPANY-ENTREPRISE"], "Équipements Boréal Ltd.");
      assert.equal(rows[0].raw["DATA_YEAR-ANNÉE_DES_DONNÉES"], 2024);
      assert.equal(rows[0].sourceRecordId, `${CID_SHEET}!2`);
      assert.equal(rows[0].observedAt, null);
      assert.equal(rows[0].identity.country, null);
    }
    await workbook(path, sourceRows, "xlsx", [...CID_HEADERS.slice(0, 5), "wrong"]);
    await assert.rejects(Array.fromAsync(canadianImportersAdapter().read(path)), /header/);
    await workbook(path, [[...sourceRows[0].slice(0, 5), 2023]]);
    await assert.rejects(Array.fromAsync(canadianImportersAdapter().read(path)), /2024/);
    await writeFile(path, "this is not a workbook");
    await assert.rejects(Array.fromAsync(canadianImportersAdapter().read(path)), /sheet/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("real CID adapter publishes presence only, preserves government rows, rejects conflicts/ambiguity, and reruns idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cid-run-"));
  const db = openDatabase(join(dir, "test.sqlite"));
  try {
    const csv = join(dir, "registry.csv");
    const records = [
      ["123456 Canada Inc.", "Les Équipements Boréal Ltée", "Montréal", "QC", "H2X 1Y4"],
      ["Cedar Machinery Inc.", "", "Ottawa", "ON", "K1A 0B1"],
      ["Harbour Components Inc.", "", "Halifax", "NS", "B3H 1A1"],
      ["Harbour Components Ltd.", "", "Halifax", "NS", "B3H 1A1"],
    ];
    // Match the source's exact alternate identity after legal-form normalization.
    const runRows = sourceRows.map(row => [...row]);
    runRows[0][1] = "Les Équipements Boréal Ltd.";
    runRows[1][1] = "Les Equipements Boreal Inc.";
    const registry = records.map(([name, alternate, city, province, postal], i) => {
      const values: Record<string, string> = { "Corporation number": String(i + 1), "Corporate name - form 1": name,
        "Corporate name - form 2": alternate, "City/town": city, "Province/territory": province, "Country": "CA", "Postal code": postal };
      return SOURCE_COLUMNS.map(c => values[c] ?? "");
    });
    await writeFile(csv, [SOURCE_COLUMNS, ...registry].map(row => row.map(c => `"${c.replaceAll('"', '""')}"`).join(",")).join("\n"));
    await importCorporations(db, csv);
    const before = db.prepare("SELECT * FROM accounts ORDER BY id").all();
    const path = join(dir, "major-importers.xls");
    await workbook(path, runRows);
    const first = await importBulkEvidence(db, path, canadianImportersAdapter());
    assert.equal(first.rowsProcessed, 8);
    assert.equal(first.uniqueSourceCompanies, 7);
    assert.equal(first.matchedSourceCompanies, 2);
    assert.equal(first.matchedCorporations, 2);
    assert.equal(first.ambiguousMatches, 1);
    assert.equal(first.probableMatches, 1);
    assert.equal(first.unmatchedSourceCompanies, 4);
    assert.equal(first.evidenceCreated, 2);
    const coverage = getEvidenceCoverage(db, { corporationId: 1 });
    assert.deepEqual(coverage.observations.map(o => [o.signal, o.value]), [["is_importer", true]]);
    assert.equal(coverage.observations[0].metadata.data_year, 2024);
    assert.equal(coverage.observations[0].metadata.source_label, "Canadian Importers Database 2024");
    assert.deepEqual(coverage.observations[0].sourceRows.map(r => r.rowNumber), [2, 3]);
    const explanation = coverage.observations[0].metadata.matching as Record<string, unknown>;
    assert.equal(explanation.alternate_name_match, true);
    assert.equal(explanation.postal_match, true);
    assert.equal(getEvidenceCoverage(db, { corporationId: 3 }).hasEvidence, false);
    const ids = db.prepare("SELECT id FROM company_evidence ORDER BY id").all();
    await workbook(path, [...runRows].reverse());
    const second = await importBulkEvidence(db, path, canadianImportersAdapter());
    assert.equal(second.evidenceCreated, 0);
    assert.equal(second.evidenceUpdated, 2);
    assert.equal(second.evidenceRemoved, 0);
    assert.deepEqual(db.prepare("SELECT id FROM company_evidence ORDER BY id").all(), ids);
    assert.deepEqual(db.prepare("SELECT * FROM accounts ORDER BY id").all(), before);
    assert.equal(db.prepare("SELECT count(*) n FROM evidence_source_rows").get()!.n, 16);
    const other = openDatabase(join(dir, "test.sqlite"));
    try {
      await withEvidenceImportLock(db, async () => {
        await assert.rejects(importBulkEvidence(other, path, canadianImportersAdapter()), /holds/);
      });
    } finally { other.close(); }
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("local evidence endpoint streams completion, handles missing/invalid files, and prevents overlapping requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cid-endpoint-"));
  const previousDb = process.env.BDR_DATABASE_PATH;
  const previousSource = process.env.BDR_CANADIAN_IMPORTERS_PATH;
  process.env.BDR_DATABASE_PATH = join(dir, "isolated.sqlite");
  process.env.BDR_CANADIAN_IMPORTERS_PATH = join(dir, "input.xls");
  const request = () => new Request("http://localhost/api/evidence/import", { method: "POST", headers: { origin: "http://localhost" } });
  try {
    assert.equal((await POST(request())).status, 422);
    assert.equal((await POST(new Request("http://localhost/api/evidence/import", { method: "POST", headers: { origin: "https://unrelated.example" } }))).status, 403);
    await workbook(process.env.BDR_CANADIAN_IMPORTERS_PATH, [sourceRows[0]]);
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal((await POST(request())).status, 409);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(events.at(-1).type, "completed");
    assert.equal(events.at(-1).report.rowsProcessed, 1);
    assert.equal(events.at(-1).report.jevStatus, "not_run");
    assert.equal(events.at(-1).report.evidenceCreated, 0);
    await writeFile(process.env.BDR_CANADIAN_IMPORTERS_PATH, "invalid");
    const failed = await POST(request());
    assert.equal(JSON.parse((await failed.text()).trim()).type, "error");
    const db = openDatabase(process.env.BDR_DATABASE_PATH);
    try { assert.equal(db.prepare("SELECT stage FROM evidence_workflows ORDER BY run_id DESC LIMIT 1").get()!.stage, "failed"); }
    finally { db.close(); }
  } finally {
    if (previousDb === undefined) delete process.env.BDR_DATABASE_PATH; else process.env.BDR_DATABASE_PATH = previousDb;
    if (previousSource === undefined) delete process.env.BDR_CANADIAN_IMPORTERS_PATH; else process.env.BDR_CANADIAN_IMPORTERS_PATH = previousSource;
    await rm(dir, { recursive: true, force: true });
  }
});
