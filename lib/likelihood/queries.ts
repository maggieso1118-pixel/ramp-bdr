import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "../db/database.ts";
import { REGISTRY_VERSION } from "../resolution/names.ts";
import { LIKELIHOOD_VERSION } from "./score.ts";
import { importerPresenceHash, latestRegistryChangeImportId } from "./prepare.ts";

export function getLikelihoodState(db: DatabaseSync = getDatabase()) {
  const row = db.prepare("SELECT * FROM commercial_likelihood_state WHERE id=1").get();
  if (!row) return { ready: false, scored: 0, scoredAt: null, staleEvidence: false };
  const staleEvidence = row.evidence_sha256 !== importerPresenceHash(db);
  const ready = row.version === LIKELIHOOD_VERSION && row.registry_version === REGISTRY_VERSION && !staleEvidence &&
    Number(row.registry_change_import_id) === latestRegistryChangeImportId(db);
  return { ready, scored: Number(row.candidate_count), scoredAt: String(row.scored_at), staleEvidence };
}

export function getCommercialLikelihoodScore(db: DatabaseSync, corporationId: number) {
  const row = db.prepare(`SELECT s.* FROM commercial_likelihood_scores s JOIN accounts a ON a.id=s.corporation_id
    WHERE s.corporation_id=? AND s.version=? AND s.source_updated_at=a.updated_at`).get(corporationId, LIKELIHOOD_VERSION);
  if (!row || !getLikelihoodState(db).ready) return null;
  const detail = JSON.parse(String(row.signals_json)) as {
    raw: number; name_used: string; signals: { reason: string; points: number; explanation: string }[] };
  return { score: Number(row.score), label: String(row.label), summary: String(row.summary), ...detail,
    version: String(row.version), scoredAt: String(row.scored_at), hasImporterEvidence: Boolean(row.has_importer_evidence) };
}

/** Keyset access for a later Jev phase. No quota or arbitrary universe cap is built in. */
export function getRankedLikelihoodCandidates(db: DatabaseSync, options: {
  afterScore?: number; afterId?: number; limit?: number } = {}) {
  const afterScore = options.afterScore ?? 101;
  const afterId = options.afterId ?? 0;
  const limit = options.limit ?? 1000;
  if (!Number.isInteger(afterScore) || afterScore < 0 || afterScore > 101 ||
    !Number.isSafeInteger(afterId) || afterId < 0 || !Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error("Use an afterScore of 0–101, nonnegative afterId, and limit of 1–5000.");
  }
  if (!getLikelihoodState(db).ready) return [];
  return db.prepare(`SELECT s.corporation_id,a.source_id,a.legal_name,a.alternate_name,s.score,s.label,s.summary
    FROM commercial_likelihood_scores s JOIN accounts a ON a.id=s.corporation_id
    WHERE s.version=? AND s.source_updated_at=a.updated_at
      AND (s.score<? OR (s.score=? AND s.corporation_id>?))
    ORDER BY s.score DESC,s.corporation_id ASC LIMIT ?`)
    .all(LIKELIHOOD_VERSION, afterScore, afterScore, afterId, limit);
}
