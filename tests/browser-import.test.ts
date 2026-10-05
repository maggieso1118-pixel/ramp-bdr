import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../lib/db/database.ts";
import { SOURCE_COLUMNS } from "../lib/corporations/normalize.ts";
import { importBrowserCsv, RegistryUploadError } from "../lib/corporations/browser-import.ts";

function csv(name: string) {
  const row = SOURCE_COLUMNS.map(column => column === "Corporation number" ? "000123" :
    column === "Corporate name - form 1" ? name : column === "City/town" ? "Toronto" :
      column === "Province/territory" ? "ON" : "");
  return [SOURCE_COLUMNS, row].map(values => values.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
}
function upload(body: string, filename = "corporations-active-cbca-en.csv", headers: Record<string,string> = {}) {
  return new Request("http://127.0.0.1:3100/api/registry/import", {
    method: "POST", body, headers: { "x-file-name": encodeURIComponent(filename), "content-type": "text/csv", ...headers },
  });
}

test("browser CSV import uses the real importer and leaves re-uploads idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bdr-browser-import-test-"));
  const path = join(directory, "registry.sqlite");
  try {
    const body = csv("Northstar Technologies Inc.");
    const sha = createHash("sha256").update(body).digest("hex");
    await assert.rejects(importBrowserCsv(upload(body), path, "0".repeat(64)),
      (error: unknown) => error instanceof RegistryUploadError && error.status === 422);
    const first = await importBrowserCsv(upload(body), path, sha);
    assert.deepEqual([first.total, first.report.inserted, first.report.updated], [1, 1, 0]);
    const db = openDatabase(path);
    const original = db.prepare("SELECT id,raw_data FROM accounts WHERE source_id='000123'").get()!;
    assert.equal(db.prepare("SELECT normalized_legal_name FROM registry_profiles WHERE corporation_id=?").get(original.id)!.normalized_legal_name, "northstar technologies");
    db.close();

    const repeat = await importBrowserCsv(upload(body), path, sha);
    assert.deepEqual([repeat.total, repeat.report.inserted, repeat.report.updated, repeat.report.skipped_existing], [1, 0, 0, 1]);
    const changed = await importBrowserCsv(upload(csv("Northstar Services Ltd.")), path, null);
    assert.equal(changed.report.updated, 1);
    const final = openDatabase(path);
    assert.equal(final.prepare("SELECT id FROM accounts WHERE source_id='000123'").get()!.id, original.id);
    assert.equal(final.prepare("SELECT normalized_legal_name FROM registry_profiles WHERE corporation_id=?").get(original.id)!.normalized_legal_name, "northstar services");
    assert.equal(final.prepare("SELECT count(*) AS n FROM accounts").get()!.n, 1);
    assert.equal(final.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    final.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("browser upload rejects wrong formats, empty files and oversized requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bdr-browser-error-test-"));
  const path = join(directory, "registry.sqlite");
  try {
    await assert.rejects(importBrowserCsv(upload("hello", "wrong.txt"), path, null),
      (error: unknown) => error instanceof RegistryUploadError && error.status === 400);
    await assert.rejects(importBrowserCsv(upload("", "empty.csv"), path, null),
      (error: unknown) => error instanceof RegistryUploadError && error.status === 400);
    await assert.rejects(importBrowserCsv(upload("hello", "large.csv", { "content-length": String(201 * 1024 * 1024) }), path, null),
      (error: unknown) => error instanceof RegistryUploadError && error.status === 413);
    await assert.rejects(importBrowserCsv(upload("company,city\nAcme,Toronto", "unsupported.csv"), path, null), /Unsupported CSV header/);
    const db = openDatabase(path);
    assert.equal(db.prepare("SELECT count(*) AS n FROM accounts").get()!.n, 0);
    db.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
