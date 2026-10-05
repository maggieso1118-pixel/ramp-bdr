import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse";
import { normalizeCorporation, SOURCE_COLUMNS } from "./normalize.ts";
import type { RawCorporation } from "./normalize.ts";
import type { ImportReport } from "./types.ts";
import { createProfileWriter } from "../resolution/profiles.ts";
import { REGISTRY_VERSION } from "../resolution/names.ts";

type ImportOptions = {
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (report: ImportReport) => void;
};

/** A bounded stream; at most one batch of source records is retained in JS. */
export async function importCorporations(db: DatabaseSync, filename: string, options: ImportOptions = {}) {
  const file = await stat(filename);
  if (!file.isFile()) throw new Error("Choose a CSV file, not a directory.");
  const started = performance.now();
  const timestamp = new Date().toISOString();
  const batchSize = Math.max(1, Math.min(5000, options.batchSize ?? 1000));
  const insertedImport = db.prepare(`
    INSERT INTO imports(filename, file_size, status, started_at) VALUES (?, ?, 'running', ?)
  `).run(basename(filename), file.size, timestamp);
  const report: ImportReport = {
    id: Number(insertedImport.lastInsertRowid), filename: basename(filename), file_size: file.size,
    status: "running", started_at: timestamp, completed_at: null,
    processed: 0, inserted: 0, updated: 0, skipped_existing: 0, invalid: 0,
    duplicate_source_ids: 0, duration_ms: 0, error: null, invalid_examples: "[]",
  };
  const issues: string[] = [];
  const saveReport = db.prepare(`UPDATE imports SET
    status=?, completed_at=?, processed=?, inserted=?, updated=?, skipped_existing=?, invalid=?,
    duplicate_source_ids=?, duration_ms=?, error=?, invalid_examples=? WHERE id=?`);
  function persistReport() {
    report.duration_ms = Math.round(performance.now() - started);
    report.invalid_examples = JSON.stringify(issues);
    saveReport.run(report.status, report.completed_at, report.processed, report.inserted,
      report.updated, report.skipped_existing, report.invalid, report.duplicate_source_ids,
      report.duration_ms, report.error, report.invalid_examples, report.id);
  }

  // Disk-backed temporary IDs count duplicates inside this file without a huge JS Set.
  db.exec("CREATE TEMP TABLE import_seen_ids (source_id TEXT PRIMARY KEY) WITHOUT ROWID");
  const markSeen = db.prepare("INSERT OR IGNORE INTO import_seen_ids(source_id) VALUES (?)");
  const existingAccount = db.prepare(`SELECT a.id, a.raw_data, a.updated_at, p.version, p.source_updated_at
    FROM accounts a LEFT JOIN registry_profiles p ON p.corporation_id=a.id WHERE a.source_id=?`);
  const writeProfile = createProfileWriter(db);
  const columns = [
    "source_id", "business_number", "legal_name", "alternate_name", "governing_legislation",
    "status", "status_detail", "anniversary_date", "last_annual_filing_year", "last_annual_meeting_date",
    "street", "street_2", "city", "province_raw", "province_normalized", "country", "postal_code_raw",
    "postal_code_normalized", "min_directors", "max_directors", "source", "raw_data",
  ] as const;
  const upsert = db.prepare(`
    INSERT INTO accounts (${columns.join(",")}, imported_at, updated_at, import_id)
    VALUES (${[...columns, "imported_at", "updated_at", "import_id"].map(() => "?").join(",")})
    ON CONFLICT(source_id) DO UPDATE SET
      ${columns.filter(c => c !== "source_id").map(c => `${c}=excluded.${c}`).join(",")},
      updated_at=excluded.updated_at, import_id=excluded.import_id
  `);

  let header: string[] | null = null;
  let batch: string[][] = [];
  function flush() {
    if (!batch.length) return;
    const before = { ...report };
    const issueCount = issues.length;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of batch) {
        report.processed++;
        if (record.length !== header!.length) {
          report.invalid++;
          if (issues.length < 10) issues.push(`Data row ${report.processed}: expected 18 fields, received ${record.length}.`);
          continue;
        }
        const raw = Object.fromEntries(header!.map((name, i) => [name, record[i]])) as RawCorporation;
        const account = normalizeCorporation(raw);
        if (!account) {
          report.invalid++;
          if (issues.length < 10) issues.push(`Data row ${report.processed}: missing corporation number.`);
          continue;
        }
        if (Number(markSeen.run(account.source_id).changes) === 0) {
          report.duplicate_source_ids++;
          report.skipped_existing++;
          continue; // First occurrence of a source ID in one file wins.
        }
        const existing = existingAccount.get(account.source_id);
        if (existing?.raw_data === account.raw_data) {
          if (existing.version !== REGISTRY_VERSION || existing.source_updated_at !== existing.updated_at) {
            writeProfile({ ...account, id: Number(existing.id), updated_at: String(existing.updated_at) });
          }
          report.skipped_existing++;
          continue;
        }
        const result = upsert.run(...columns.map(c => account[c]), timestamp, timestamp, report.id);
        writeProfile({ ...account, id: Number(existing?.id ?? result.lastInsertRowid), updated_at: timestamp });
        if (existing) report.updated++;
        else report.inserted++;
      }
      persistReport();
      db.exec("COMMIT");
      batch = [];
    } catch (error) {
      db.exec("ROLLBACK");
      Object.assign(report, before);
      issues.length = issueCount;
      batch = [];
      throw error;
    }
    options.onProgress?.({ ...report });
  }

  const input = createReadStream(filename, { signal: options.signal, highWaterMark: 64 * 1024 });
  const parser = parse({ bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 1024 * 1024 });
  input.on("error", error => parser.destroy(error));
  input.pipe(parser);
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (!header) {
        header = record.map(h => h.trim());
        if (header.length !== SOURCE_COLUMNS.length || new Set(header).size !== SOURCE_COLUMNS.length ||
          !SOURCE_COLUMNS.every(c => header!.includes(c))) {
          throw new Error("Unsupported CSV header. Expected the 18 Government of Canada federal corporation columns.");
        }
        continue;
      }
      batch.push(record);
      if (batch.length >= batchSize) flush();
    }
    if (!header) throw new Error("The CSV is empty; no header was found.");
    flush();
    if (!report.processed) throw new Error("The CSV contains a header but no corporation records.");
    if (!report.inserted && !report.updated && !report.skipped_existing) {
      throw new Error("No valid corporation numbers were found. Check the import report for skipped rows.");
    }
    db.exec("INSERT INTO accounts_search(accounts_search) VALUES ('optimize'); PRAGMA optimize;");
    report.status = "completed";
    report.completed_at = new Date().toISOString();
    persistReport();
    return report;
  } catch (error) {
    // Keep already committed batches and record an explicit failure. Re-running is safe.
    report.status = "failed";
    report.completed_at = new Date().toISOString();
    report.error = error instanceof Error ? error.message : "Import failed.";
    persistReport();
    throw new Error(`Import ${report.id} failed after ${report.processed.toLocaleString()} committed rows: ${report.error}`, { cause: error });
  } finally {
    input.destroy();
    parser.destroy();
    db.exec("DROP TABLE IF EXISTS temp.import_seen_ids");
  }
}
