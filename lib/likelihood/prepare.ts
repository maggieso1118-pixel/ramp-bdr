import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { REGISTRY_VERSION } from "../resolution/names.ts";
import { CANADIAN_IMPORTERS_SOURCE } from "../evidence/canadian-importers-config.ts";
import { LIKELIHOOD_VERSION, scoreCommercialLikelihood } from "./score.ts";
import type { LikelihoodInput } from "./score.ts";

/** Hash only published positive presence by corporation. Re-imported identical evidence has the same hash. */
export function importerPresenceHash(db: DatabaseSync) {
  const hash = createHash("sha256");
  for (const row of db.prepare(`SELECT DISTINCT corporation_id FROM company_evidence
    WHERE source=? AND signal_type='is_importer' AND value_boolean=1 AND corporation_id IS NOT NULL
    ORDER BY corporation_id`).iterate(CANADIAN_IMPORTERS_SOURCE)) {
    hash.update(String(row.corporation_id) + "\n");
  }
  return hash.digest("hex");
}

/** Unchanged re-imports do not invalidate scores; committed source changes do. */
export function latestRegistryChangeImportId(db: DatabaseSync) {
  return Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM imports WHERE inserted>0 OR updated>0").get()!.id);
}

type ScoreRow = LikelihoodInput & { id: number; updated_at: string };
/** One atomic derived-table refresh. The registry and evidence tables are only read. */
export function prepareCommercialLikelihood(db: DatabaseSync, onProgress?: (processed: number) => void) {
  const started = performance.now();
  const scoredAt = new Date().toISOString();
  const select = db.prepare(`SELECT a.id,a.updated_at,a.min_directors,a.max_directors,a.last_annual_filing_year,
    p.normalized_legal_name,p.normalized_alternate_name,p.is_numbered_corporation,
    p.is_professional_corporation,p.is_holding_company,p.is_investment_entity,
    p.is_real_estate_holding_entity,p.is_management_company,p.is_generic_legal_name,
    p.has_alternate_name,p.has_useful_location,
    EXISTS(SELECT 1 FROM company_evidence e WHERE e.corporation_id=a.id
      AND e.source=? AND e.signal_type='is_importer' AND e.value_boolean=1) has_importer_evidence
    FROM registry_profiles p JOIN accounts a ON a.id=p.corporation_id
    WHERE p.version=? AND p.source_updated_at=a.updated_at AND p.is_candidate=1 AND a.id>?
    ORDER BY a.id LIMIT 1000`);
  const upsert = db.prepare(`INSERT INTO commercial_likelihood_scores
    (corporation_id,score,label,summary,signals_json,version,source_updated_at,has_importer_evidence,scored_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(corporation_id) DO UPDATE SET
      score=excluded.score,label=excluded.label,summary=excluded.summary,
      signals_json=excluded.signals_json,version=excluded.version,
      source_updated_at=excluded.source_updated_at,has_importer_evidence=excluded.has_importer_evidence,
      scored_at=excluded.scored_at
    WHERE score!=excluded.score OR label!=excluded.label OR summary!=excluded.summary
      OR signals_json!=excluded.signals_json OR version!=excluded.version
      OR source_updated_at!=excluded.source_updated_at OR has_importer_evidence!=excluded.has_importer_evidence
    RETURNING corporation_id`);
  let afterId = 0, scored = 0, changed = 0, removed = 0, evidenceHash = "";
  db.exec("BEGIN IMMEDIATE");
  try {
    evidenceHash = importerPresenceHash(db);
    const registryChangeImportId = latestRegistryChangeImportId(db);
    while (true) {
      const rows = select.all(CANADIAN_IMPORTERS_SOURCE, REGISTRY_VERSION, afterId) as ScoreRow[];
      if (!rows.length) break;
      for (const row of rows) {
        const result = scoreCommercialLikelihood(row);
        const saved = upsert.get(row.id, result.score, result.label, result.summary,
          JSON.stringify({ raw: result.raw, name_used: result.name_used, signals: result.signals }),
          LIKELIHOOD_VERSION, row.updated_at, row.has_importer_evidence, scoredAt);
        if (saved) changed++;
        scored++;
      }
      afterId = rows.at(-1)!.id;
      if (scored % 10000 === 0) onProgress?.(scored);
    }
    removed = Number(db.prepare(`DELETE FROM commercial_likelihood_scores WHERE corporation_id NOT IN
      (SELECT p.corporation_id FROM registry_profiles p JOIN accounts a ON a.id=p.corporation_id
        WHERE p.version=? AND p.source_updated_at=a.updated_at AND p.is_candidate=1)`).run(REGISTRY_VERSION).changes);
    db.prepare(`INSERT INTO commercial_likelihood_state(id,version,registry_version,evidence_sha256,candidate_count,registry_change_import_id,scored_at)
      VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,
      registry_version=excluded.registry_version,evidence_sha256=excluded.evidence_sha256,
      candidate_count=excluded.candidate_count,registry_change_import_id=excluded.registry_change_import_id,
      scored_at=excluded.scored_at`)
      .run(LIKELIHOOD_VERSION, REGISTRY_VERSION, evidenceHash, scored, registryChangeImportId, scoredAt);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { scored, changed, removed, evidenceHash, version: LIKELIHOOD_VERSION,
    durationMs: Math.round(performance.now() - started) };
}
