import type { DatabaseSync } from "node:sqlite";
import { FLAG_NAMES } from "./names.ts";

/** Additive schema only. Opening the app never scans/backfills the registry. */
export function initializeResolutionSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_profiles (
      corporation_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      normalized_legal_name TEXT NOT NULL,
      normalized_alternate_name TEXT NOT NULL,
      relaxed_legal_name TEXT NOT NULL,
      relaxed_alternate_name TEXT NOT NULL,
      ${FLAG_NAMES.map(flag => `${flag} INTEGER NOT NULL CHECK (${flag} IN (0,1))`).join(",")},
      is_candidate INTEGER NOT NULL CHECK(is_candidate IN (0,1)),
      candidate_reason TEXT NOT NULL,
      version TEXT NOT NULL,
      source_updated_at TEXT NOT NULL,
      derived_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS registry_profiles_candidates ON registry_profiles(version, is_candidate, corporation_id);
    CREATE INDEX IF NOT EXISTS registry_profiles_legal ON registry_profiles(normalized_legal_name);
    CREATE INDEX IF NOT EXISTS registry_profiles_alternate ON registry_profiles(normalized_alternate_name) WHERE normalized_alternate_name != '';

    CREATE TABLE IF NOT EXISTS commercial_companies (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL CHECK(length(trim(provider)) > 0),
      provider_company_id TEXT NOT NULL CHECK(length(trim(provider_company_id)) > 0),
      name TEXT,
      normalized_name TEXT NOT NULL DEFAULT '',
      domain TEXT, industry TEXT, description TEXT,
      employee_count INTEGER CHECK(employee_count >= 0), employee_range TEXT, revenue_range TEXT,
      hq_city TEXT, hq_region TEXT, hq_country TEXT,
      location_count INTEGER CHECK(location_count >= 0), subsidiary_count INTEGER CHECK(subsidiary_count >= 0),
      parent_company TEXT, headcount_growth_12m REAL,
      latest_funding_date TEXT, latest_funding_amount REAL CHECK(latest_funding_amount >= 0),
      raw_json TEXT CHECK(raw_json IS NULL OR json_valid(raw_json)),
      enriched_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_company_id)
    );
    CREATE INDEX IF NOT EXISTS commercial_companies_name ON commercial_companies(normalized_name);
    CREATE TABLE IF NOT EXISTS enrichment_runs (
      id INTEGER PRIMARY KEY, provider TEXT NOT NULL, version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
      started_at TEXT NOT NULL, completed_at TEXT,
      records_processed INTEGER NOT NULL DEFAULT 0 CHECK(records_processed >= 0),
      records_created INTEGER NOT NULL DEFAULT 0 CHECK(records_created >= 0),
      records_updated INTEGER NOT NULL DEFAULT 0 CHECK(records_updated >= 0),
      records_failed INTEGER NOT NULL DEFAULT 0 CHECK(records_failed >= 0),
      config_hash TEXT NOT NULL, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS corporation_company_matches (
      id INTEGER PRIMARY KEY,
      corporation_id INTEGER NOT NULL REFERENCES accounts(id),
      company_id INTEGER NOT NULL REFERENCES commercial_companies(id),
      match_method TEXT NOT NULL, name_similarity REAL NOT NULL CHECK(name_similarity BETWEEN 0 AND 1),
      location_match TEXT NOT NULL CHECK(location_match IN ('city_province','province','none','conflict')),
      provider_confidence REAL CHECK(provider_confidence BETWEEN 0 AND 1),
      match_confidence REAL NOT NULL CHECK(match_confidence BETWEEN 0 AND 1),
      match_status TEXT NOT NULL DEFAULT 'candidate' CHECK(match_status IN ('candidate','accepted','rejected','ambiguous')),
      exact_name_match INTEGER NOT NULL CHECK(exact_name_match IN (0,1)),
      city_match INTEGER NOT NULL CHECK(city_match IN (0,1)),
      province_match INTEGER NOT NULL CHECK(province_match IN (0,1)),
      alternate_name_match INTEGER NOT NULL CHECK(alternate_name_match IN (0,1)),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
      enrichment_run_id INTEGER REFERENCES enrichment_runs(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(corporation_id, company_id)
    );
    CREATE INDEX IF NOT EXISTS corporation_company_matches_company ON corporation_company_matches(company_id);
  `);
}
