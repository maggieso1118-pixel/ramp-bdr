import type { DatabaseSync } from "node:sqlite";

export function initializeEvidenceSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_workflows (
      run_id INTEGER PRIMARY KEY REFERENCES enrichment_runs(id),
      source TEXT NOT NULL, filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
      adapter_version TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('source_ready','preparing_candidates','matching_evidence','evidence_ready','failed')),
      jev_status TEXT NOT NULL DEFAULT 'not_run' CHECK(jev_status='not_run'),
      report_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(report_json)), error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evidence_workflows_source ON evidence_workflows(source,run_id);
    CREATE TABLE IF NOT EXISTS evidence_source_companies (
      id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES evidence_workflows(run_id),
      source_company_key TEXT NOT NULL, source_identity_json TEXT NOT NULL CHECK(json_valid(source_identity_json)),
      normalized_identity_json TEXT NOT NULL CHECK(json_valid(normalized_identity_json)),
      outcome TEXT CHECK(outcome IN ('accepted','ambiguous','candidate','unmatched')), outcome_reason TEXT,
      UNIQUE(run_id,source_company_key)
    );
    CREATE TABLE IF NOT EXISTS evidence_source_rows (
      id INTEGER PRIMARY KEY, source_company_id INTEGER NOT NULL REFERENCES evidence_source_companies(id),
      row_number INTEGER NOT NULL, source_record_id TEXT,
      raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
      attributes_json TEXT NOT NULL CHECK(json_valid(attributes_json)), observed_at TEXT,
      UNIQUE(source_company_id,row_number)
    );
    CREATE INDEX IF NOT EXISTS evidence_source_rows_company ON evidence_source_rows(source_company_id);
    CREATE TABLE IF NOT EXISTS evidence_registry_locations (
      corporation_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      city TEXT NOT NULL, province TEXT NOT NULL, source_updated_at TEXT NOT NULL, version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evidence_registry_location ON evidence_registry_locations(city,province,corporation_id);
    CREATE TABLE IF NOT EXISTS evidence_identity_matches (
      id INTEGER PRIMARY KEY, source_company_id INTEGER NOT NULL REFERENCES evidence_source_companies(id),
      corporation_id INTEGER NOT NULL REFERENCES accounts(id),
      match_status TEXT NOT NULL CHECK(match_status IN ('accepted','candidate','ambiguous','rejected')),
      match_method TEXT NOT NULL, match_confidence REAL NOT NULL CHECK(match_confidence BETWEEN 0 AND 1),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
      UNIQUE(source_company_id,corporation_id)
    );
    CREATE TABLE IF NOT EXISTS company_evidence (
      id INTEGER PRIMARY KEY,
      company_id INTEGER REFERENCES commercial_companies(id), corporation_id INTEGER REFERENCES accounts(id),
      source TEXT NOT NULL CHECK(length(trim(source)) > 0), source_company_key TEXT NOT NULL,
      signal_type TEXT NOT NULL CHECK(length(trim(signal_type)) > 0),
      value_text TEXT, value_number REAL, value_boolean INTEGER CHECK(value_boolean IN (0,1)),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)), observed_at TEXT,
      match_confidence REAL CHECK(match_confidence BETWEEN 0 AND 1),
      run_id INTEGER REFERENCES evidence_workflows(run_id), source_company_id INTEGER REFERENCES evidence_source_companies(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK(company_id IS NOT NULL OR corporation_id IS NOT NULL),
      CHECK((value_text IS NOT NULL)+(value_number IS NOT NULL)+(value_boolean IS NOT NULL)=1)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS company_evidence_identity ON company_evidence(
      source,source_company_key,signal_type,coalesce(company_id,0),coalesce(corporation_id,0));
    CREATE INDEX IF NOT EXISTS company_evidence_corporation ON company_evidence(corporation_id,source);
    CREATE INDEX IF NOT EXISTS company_evidence_company ON company_evidence(company_id,source);
  `);
}
