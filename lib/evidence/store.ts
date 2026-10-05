import type { DatabaseSync } from "node:sqlite";
import type { EvidenceTarget, EvidenceValue } from "./types.ts";

export type EvidenceInput = EvidenceTarget & {
  source: string; sourceCompanyKey: string; signal: string; value: EvidenceValue;
  metadata?: Record<string, unknown>; observedAt?: string | null; matchConfidence?: number | null;
  runId?: number | null; sourceCompanyId?: number | null;
};

/** Null clears this observation. It is never stored as false or zero. */
export function upsertEvidence(db: DatabaseSync, input: EvidenceInput) {
  const company = input.companyId ?? null;
  const corporation = input.corporationId ?? null;
  if (!company && !corporation) throw new Error("Evidence requires a company or corporation.");
  if (!input.source.trim() || !input.sourceCompanyKey.trim() || !input.signal.trim()) throw new Error("Evidence requires a source, source identity, and signal.");
  if (typeof input.value === "number" && !Number.isFinite(input.value)) throw new Error("Evidence numbers must be finite.");
  const identity = [input.source, input.sourceCompanyKey, input.signal, company ?? 0, corporation ?? 0];
  const existing = db.prepare(`SELECT id FROM company_evidence WHERE source=? AND source_company_key=?
    AND signal_type=? AND coalesce(company_id,0)=? AND coalesce(corporation_id,0)=?`).get(...identity);
  if (input.value === null) {
    if (existing) db.prepare("DELETE FROM company_evidence WHERE id=?").run(existing.id);
    return { id: null, created: false, removed: Boolean(existing) };
  }
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO company_evidence(company_id,corporation_id,source,source_company_key,
    signal_type,value_text,value_number,value_boolean,metadata_json,observed_at,match_confidence,
    run_id,source_company_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT DO UPDATE SET value_text=excluded.value_text,value_number=excluded.value_number,
    value_boolean=excluded.value_boolean,metadata_json=excluded.metadata_json,observed_at=excluded.observed_at,
    match_confidence=excluded.match_confidence,run_id=excluded.run_id,source_company_id=excluded.source_company_id,
    updated_at=excluded.updated_at RETURNING id`).get(company, corporation, input.source, input.sourceCompanyKey,
      input.signal, typeof input.value === "string" ? input.value : null,
      typeof input.value === "number" ? input.value : null, typeof input.value === "boolean" ? Number(input.value) : null,
      JSON.stringify(input.metadata ?? {}), input.observedAt ?? null, input.matchConfidence ?? null,
      input.runId ?? null, input.sourceCompanyId ?? null, now, now)!;
  return { id: Number(result.id), created: !existing, removed: false };
}

/** Missing evidence means unknown; a known false observation still counts as coverage. */
export function getEvidenceCoverage(db: DatabaseSync, target: EvidenceTarget) {
  if (!target.companyId && !target.corporationId) throw new Error("Choose an evidence target.");
  const rows = db.prepare(`SELECT id,source,signal_type,value_text,value_number,value_boolean,observed_at,match_confidence,metadata_json,source_company_id
    FROM company_evidence WHERE ${target.corporationId ? "corporation_id" : "company_id"}=? ORDER BY source,signal_type`)
    .all(target.corporationId ?? target.companyId!);
  return { hasEvidence: rows.length > 0, sources: [...new Set(rows.map(row => String(row.source)))], observations: rows.map(row => ({
    source: String(row.source), signal: String(row.signal_type),
    value: row.value_boolean !== null ? Boolean(row.value_boolean) : row.value_number ?? row.value_text,
    id: Number(row.id), observedAt: row.observed_at, matchConfidence: row.match_confidence,
    metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
    sourceRows: row.source_company_id === null ? [] : db.prepare(`SELECT row_number,source_record_id,raw_json
      FROM evidence_source_rows WHERE source_company_id=? ORDER BY row_number LIMIT 25`).all(row.source_company_id).map(sourceRow => ({
        rowNumber: Number(sourceRow.row_number), recordId: String(sourceRow.source_record_id ?? ""), raw: JSON.parse(String(sourceRow.raw_json)),
      })),
  })) };
}
