import type { DatabaseSync } from "node:sqlite";

/** Additive derived data. Opening the app does not launch scoring. */
export function initializeLikelihoodSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commercial_likelihood_scores (
      corporation_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      label TEXT NOT NULL, summary TEXT NOT NULL,
      signals_json TEXT NOT NULL CHECK(json_valid(signals_json)),
      version TEXT NOT NULL, source_updated_at TEXT NOT NULL,
      has_importer_evidence INTEGER NOT NULL CHECK(has_importer_evidence IN (0,1)),
      scored_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS commercial_likelihood_rank ON commercial_likelihood_scores(score DESC, corporation_id ASC);
    CREATE TABLE IF NOT EXISTS commercial_likelihood_state (
      id INTEGER PRIMARY KEY CHECK(id=1),
      version TEXT NOT NULL, registry_version TEXT NOT NULL,
      evidence_sha256 TEXT NOT NULL, candidate_count INTEGER NOT NULL,
      registry_change_import_id INTEGER NOT NULL DEFAULT 0,
      scored_at TEXT NOT NULL
    );
  `);
  const columns = db.prepare("PRAGMA table_info(commercial_likelihood_state)").all();
  if (!columns.some(column => column.name === "registry_change_import_id")) {
    db.exec("ALTER TABLE commercial_likelihood_state ADD COLUMN registry_change_import_id INTEGER NOT NULL DEFAULT 0");
  }
}
