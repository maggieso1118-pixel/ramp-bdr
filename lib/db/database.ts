import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initializeResolutionSchema } from "../resolution/schema.ts";
import { initializeEvidenceSchema } from "../evidence/schema.ts";
import { initializeLikelihoodSchema } from "../likelihood/schema.ts";

export function databasePath() {
  // Runtime data must not be traced into the Next build.
  return resolve(/* turbopackIgnore: true */ process.env.BDR_DATABASE_PATH || "data/corporations.sqlite");
}

export function openDatabase(path = databasePath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 10000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = FILE;

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped_existing INTEGER NOT NULL DEFAULT 0,
      invalid INTEGER NOT NULL DEFAULT 0,
      duplicate_source_ids INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      invalid_examples TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      business_number TEXT,
      legal_name TEXT,
      alternate_name TEXT,
      governing_legislation TEXT,
      status TEXT,
      status_detail TEXT,
      anniversary_date TEXT,
      last_annual_filing_year TEXT,
      last_annual_meeting_date TEXT,
      street TEXT,
      street_2 TEXT,
      city TEXT,
      province_raw TEXT,
      province_normalized TEXT,
      country TEXT,
      postal_code_raw TEXT,
      postal_code_normalized TEXT,
      min_directors TEXT,
      max_directors TEXT,
      source TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      import_id INTEGER NOT NULL REFERENCES imports(id),
      raw_data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS accounts_legal_name ON accounts(legal_name COLLATE NOCASE, id);
    CREATE INDEX IF NOT EXISTS accounts_alternate_name ON accounts(alternate_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS accounts_business_number ON accounts(business_number);
    CREATE INDEX IF NOT EXISTS accounts_city ON accounts(city COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS accounts_province ON accounts(province_normalized, id);

    CREATE VIRTUAL TABLE IF NOT EXISTS accounts_search USING fts5(
      legal_name, alternate_name, source_id, business_number, city,
      content='accounts', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
    );
    CREATE TRIGGER IF NOT EXISTS accounts_search_insert AFTER INSERT ON accounts BEGIN
      INSERT INTO accounts_search(rowid, legal_name, alternate_name, source_id, business_number, city)
      VALUES (new.id, new.legal_name, new.alternate_name, new.source_id, new.business_number, new.city);
    END;
    CREATE TRIGGER IF NOT EXISTS accounts_search_delete AFTER DELETE ON accounts BEGIN
      INSERT INTO accounts_search(accounts_search, rowid, legal_name, alternate_name, source_id, business_number, city)
      VALUES ('delete', old.id, old.legal_name, old.alternate_name, old.source_id, old.business_number, old.city);
    END;
    CREATE TRIGGER IF NOT EXISTS accounts_search_update AFTER UPDATE ON accounts BEGIN
      INSERT INTO accounts_search(accounts_search, rowid, legal_name, alternate_name, source_id, business_number, city)
      VALUES ('delete', old.id, old.legal_name, old.alternate_name, old.source_id, old.business_number, old.city);
      INSERT INTO accounts_search(rowid, legal_name, alternate_name, source_id, business_number, city)
      VALUES (new.id, new.legal_name, new.alternate_name, new.source_id, new.business_number, new.city);
    END;
  `);
  initializeResolutionSchema(db);
  initializeEvidenceSchema(db);
  initializeLikelihoodSchema(db);
  return db;
}

const globalDatabase = globalThis as typeof globalThis & { corporationDb?: DatabaseSync };

/** Only imported by server components / CLI. No database code is sent to the browser. */
export function getDatabase() {
  globalDatabase.corporationDb ??= openDatabase();
  return globalDatabase.corporationDb;
}
