import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { databasePath, openDatabase } from "../lib/db/database.ts";
import { getCorporation, getRegistrySummary, searchCorporations } from "../lib/corporations/queries.ts";

const db = openDatabase();
try {
  const summary = getRegistrySummary(db);
  const expectedCount = process.argv[2] ? Number(process.argv[2]) : undefined;
  if (expectedCount !== undefined) assert.equal(summary.total, expectedCount);
  assert.ok(summary.total > 0, "Import the government CSV before running verification.");
  assert.equal(db.prepare("SELECT count(DISTINCT source_id) AS n FROM accounts").get()!.n, summary.total);
  assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  db.exec("INSERT INTO accounts_search(accounts_search, rank) VALUES ('integrity-check', 1)");

  const examples = [
    { kind: "Corporation number", query: "8660115", sourceId: "8660115" },
    { kind: "Numbered corporation name", query: "8448566 Canada", sourceId: "8448566" },
    { kind: "Named corporation", query: "MINDANGLER", sourceId: "8660115" },
    { kind: "City", query: "Toronto" },
    { kind: "City", query: "Vancouver" },
    { kind: "Business number", query: "835752437", sourceId: "8660115" },
    { kind: "Common prefix", query: "shop" },
  ];
  const alternate = db.prepare("SELECT source_id, alternate_name FROM accounts WHERE alternate_name IS NOT NULL LIMIT 1").get();
  if (alternate) examples.push({ kind: "Alternate name", query: String(alternate.alternate_name), sourceId: String(alternate.source_id) });
  const benchmarks = examples.map(example => {
    const timings = [];
    let result = searchCorporations({}, db);
    for (let i = 0; i < 4; i++) {
      const before = performance.now();
      result = searchCorporations({ query: example.query }, db);
      timings.push(Math.round((performance.now() - before) * 100) / 100);
    }
    assert.ok(result.total > 0, `Expected matches for ${example.query}`);
    assert.ok(result.accounts.length <= 25);
    if (example.sourceId) assert.ok(result.accounts.some(a => a.source_id === example.sourceId), example.query);
    return { ...example, matches: result.total, returned: result.accounts.length, first_ms: timings[0], warm_median_ms: timings.slice(1).sort((a,b) => a-b)[1] };
  });
  const first = searchCorporations({ query: "Toronto" }, db);
  const second = searchCorporations({ query: "Toronto", page: 2 }, db);
  assert.equal(new Set([...first.accounts, ...second.accounts].map(a => a.id)).size, 50);
  const detail = getCorporation("8660115", db)!;
  assert.equal(detail.legal_name, "MINDANGLER CAPITAL INC.");
  assert.equal(Object.keys(JSON.parse(detail.raw_data)).length, 18);
  assert.equal("icpScore" in detail, false);
  assert.equal("buyer" in detail, false);
  assert.equal("industry" in detail, false);
  const duplicateBusinessNumbers = db.prepare(`SELECT count(*) AS n FROM (
    SELECT business_number FROM accounts WHERE business_number IS NOT NULL
    GROUP BY business_number HAVING count(*) > 1
  )`).get()!.n;
  const imports = db.prepare("SELECT id, status, processed, inserted, updated, skipped_existing, invalid, duplicate_source_ids, duration_ms FROM imports ORDER BY id").all();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  console.log(JSON.stringify({
    total: summary.total, unique_source_ids: summary.total,
    duplicate_business_number_groups: duplicateBusinessNumbers,
    database_bytes: statSync(databasePath()).size,
    database_mib: Math.round(statSync(databasePath()).size / 1024 / 1024 * 10) / 10,
    integrity: "ok (SQLite and full-text index)", benchmarks, imports,
  }, null, 2));
} finally { db.close(); }
