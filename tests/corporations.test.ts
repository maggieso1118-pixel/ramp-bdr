import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../lib/db/database.ts";
import { SOURCE_COLUMNS } from "../lib/corporations/normalize.ts";
import type { SourceColumn } from "../lib/corporations/normalize.ts";
import { importCorporations } from "../lib/corporations/import.ts";
import { searchCorporations, getCorporation } from "../lib/corporations/queries.ts";

function csvRow(values: string[]) {
  return values.map(value => `"${value.replaceAll('"', '""')}"`).join(",");
}
function row(values: Partial<Record<SourceColumn, string>>) {
  return SOURCE_COLUMNS.map(column => values[column] ?? "");
}

test("streaming import preserves fidelity, separates identifiers, and stays idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bdr-import-test-"));
  const file = join(directory, "corporations.csv");
  const db = openDatabase(join(directory, "test.sqlite"));
  try {
    const source = row({
      "Corporation number": "001234", "Business number (BN)": "000987654",
      "Corporate name - form 1": '  Acme, "Research"\nCorporation  ',
      "Corporate name - form 2": "  Société  Exemple  ",
      "City/town": " Toronto ", "Province/territory": " NF ", "Country": "CA",
      "Postal code": " k1a0b1 ", "Year of last annual filing": "9999",
      "Date of last annual meeting": "2999-01-01", "Maximum number of directors": "999999999999999999999999",
    });
    const records = [source,
      row({ "Corporation number": "000002", "Business number (BN)": "000987654", "Corporate name - form 1": "12345 Canada Inc.", "City/town": "Vancouver", "Postal code": "KIA OB1", "Province/territory": "BC" }),
      row({ "Corporation number": "000003" }), // All optional values can be absent.
      source, // In-file duplicate; first occurrence wins.
      row({ "Corporate name - form 1": "Missing source ID" }),
      ["wrong", "column count"],
    ];
    await writeFile(file, "\uFEFF" + csvRow([...SOURCE_COLUMNS]) + "\r\n" + records.map(csvRow).join("\r\n"));
    const first = await importCorporations(db, file, { batchSize: 2 });
    assert.deepEqual([first.processed, first.inserted, first.updated, first.skipped_existing, first.invalid, first.duplicate_source_ids], [6, 3, 0, 1, 2, 1]);
    assert.equal(first.status, "completed");
    const stored = getCorporation("001234", db)!;
    assert.equal(stored.legal_name, 'Acme, "Research" Corporation');
    assert.equal(stored.province_raw, " NF ");
    assert.equal(stored.province_normalized, "NL");
    assert.equal(stored.postal_code_raw, " k1a0b1 ");
    assert.equal(stored.postal_code_normalized, "K1A 0B1");
    assert.equal(stored.last_annual_filing_year, "9999");
    assert.equal(stored.last_annual_meeting_date, "2999-01-01");
    assert.equal(stored.max_directors, "999999999999999999999999");
    assert.deepEqual(JSON.parse(stored.raw_data), Object.fromEntries(SOURCE_COLUMNS.map((c, i) => [c, source[i]])));
    assert.equal(getCorporation("000002", db)!.postal_code_normalized, "KIA OB1");
    assert.equal(getCorporation("000003", db)!.legal_name, null);
    assert.equal(searchCorporations({ query: "000987654" }, db).total, 2);
    assert.equal(searchCorporations({ query: "société" }, db).accounts[0].source_id, "001234");
    assert.equal(searchCorporations({ query: "tor", province: "NL" }, db).total, 1);
    assert.equal(searchCorporations({ query: "Vancouver" }, db).total, 1);
    assert.equal(searchCorporations({ query: "12345" }, db).total, 1);
    assert.equal(searchCorporations({ query: "' OR 1=1 --" }, db).total, 0);
    assert.equal(searchCorporations({ query: "*" }, db).queryTooShort, true);
    const second = await importCorporations(db, file, { batchSize: 2 });
    assert.deepEqual([second.inserted, second.updated, second.skipped_existing, second.invalid], [0, 0, 4, 2]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM accounts").get()!.n, 3);
    assert.equal(getCorporation("001234", db)!.imported_at, stored.imported_at);
    // A genuinely changed record replaces its indexed fields while keeping identity.
    await writeFile(file, csvRow([...SOURCE_COLUMNS]) + "\n" + csvRow(row({ "Corporation number": "001234", "Corporate name - form 1": "Updated Enterprise", "City/town": "Montréal" })));
    const changed = await importCorporations(db, file);
    assert.equal(changed.updated, 1);
    assert.equal(getCorporation("001234", db)!.id, stored.id);
    assert.equal(searchCorporations({ query: "acme" }, db).total, 0);
    assert.equal(searchCorporations({ query: "montreal" }, db).total, 1);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("bad headers, malformed quoting, and empty files fail visibly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bdr-error-test-"));
  const file = join(directory, "bad.csv");
  const db = openDatabase(join(directory, "test.sqlite"));
  try {
    await writeFile(file, "company,city\nAcme,Toronto\n");
    await assert.rejects(importCorporations(db, file), /Unsupported CSV header/);
    assert.equal(db.prepare("SELECT status FROM imports ORDER BY id DESC").get()!.status, "failed");
    await writeFile(file, csvRow([...SOURCE_COLUMNS]) + "\n\"unterminated");
    await assert.rejects(importCorporations(db, file), /Quote Not Closed/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM accounts").get()!.n, 0);
    await writeFile(file, "");
    await assert.rejects(importCorporations(db, file), /empty/);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a failed later batch keeps committed records and can be safely re-imported", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bdr-recovery-test-"));
  const file = join(directory, "recovery.csv");
  const db = openDatabase(join(directory, "test.sqlite"));
  try {
    const records = Array.from({ length: 2500 }, (_, i) => row({
      "Corporation number": String(i + 1),
      "Corporate name - form 1": `Recovery Corporation ${i + 1}`,
      "Street": "A long address field for testing stream boundaries ".repeat(5),
    }));
    const valid = csvRow([...SOURCE_COLUMNS]) + "\n" + records.map(csvRow).join("\n");
    await writeFile(file, valid + '\n"unterminated');
    await assert.rejects(importCorporations(db, file, { batchSize: 100 }), /Quote Not Closed/);
    const saved = Number(db.prepare("SELECT count(*) AS n FROM accounts").get()!.n);
    assert.ok(saved > 0);
    assert.equal(db.prepare("SELECT processed FROM imports ORDER BY id DESC").get()!.processed, saved);
    await writeFile(file, valid);
    const recovered = await importCorporations(db, file, { batchSize: 100 });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.skipped_existing, saved);
    assert.equal(recovered.inserted, 2500 - saved);
    assert.equal(db.prepare("SELECT count(*) AS n FROM accounts").get()!.n, 2500);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("server search paginates and bounds results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bdr-page-test-"));
  const file = join(directory, "pages.csv");
  const db = openDatabase(join(directory, "test.sqlite"));
  try {
    const records = Array.from({ length: 61 }, (_, i) => row({ "Corporation number": String(i + 1), "Corporate name - form 1": `Shop ${i + 1}`, "City/town": "Toronto" }));
    await writeFile(file, csvRow([...SOURCE_COLUMNS]) + "\n" + records.map(csvRow).join("\n"));
    await importCorporations(db, file, { batchSize: 10 });
    const first = searchCorporations({ query: "shop" }, db);
    const second = searchCorporations({ query: "shop", page: 2 }, db);
    const last = searchCorporations({ query: "shop", page: 1000000 }, db);
    assert.equal(first.total, 61);
    assert.equal(first.accounts.length, 25);
    assert.equal(second.accounts.length, 25);
    assert.equal(new Set([...first.accounts, ...second.accounts].map(a => a.id)).size, 50);
    assert.equal(last.page, 3);
    assert.equal(last.accounts.length, 11);
    assert.equal(searchCorporations({ page: NaN }, db).page, 1);
    assert.equal(searchCorporations({ query: "zzz" }, db).total, 0);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
