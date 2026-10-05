import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { normalizeCompanyName } from "./names.ts";
import type { MatchAssessment } from "./matching.ts";

const companyFields = ["name", "domain", "industry", "description", "employee_count", "employee_range", "revenue_range",
  "hq_city", "hq_region", "hq_country", "location_count", "subsidiary_count", "parent_company", "headcount_growth_12m",
  "latest_funding_date", "latest_funding_amount", "raw_json", "enriched_at"] as const;
type NumericField = "employee_count" | "location_count" | "subsidiary_count" | "headcount_growth_12m" | "latest_funding_amount";
export type CommercialCompanyInput = { provider: string; provider_company_id: string } &
  Partial<Record<Exclude<typeof companyFields[number], NumericField>, string | null>> & Partial<Record<NumericField, number | null>>;

/** Partial updates preserve omitted fields; explicit null clears a field. IDs must be stable, never inferred from name/domain. */
export function upsertCommercialCompany(db: DatabaseSync, input: CommercialCompanyInput) {
  const provider = input.provider.trim();
  const providerId = input.provider_company_id.trim();
  if (!provider || !providerId) throw new Error("A provider namespace and stable provider company ID are required.");
  const provided = companyFields.filter(field => input[field] !== undefined);
  const fields: string[] = [...provided];
  const values: SQLInputValue[] = provided.map(field => input[field]!);
  if (provided.includes("name")) { fields.push("normalized_name"); values.push(normalizeCompanyName(input.name)); }
  const now = new Date().toISOString();
  const columns = ["provider", "provider_company_id", ...fields, "created_at", "updated_at"];
  const record = db.prepare(`INSERT INTO commercial_companies (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})
    ON CONFLICT(provider,provider_company_id) DO UPDATE SET ${[...fields, "updated_at"].map(field => `${field}=excluded.${field}`).join(",")}
    RETURNING id`).get(provider, providerId, ...values, now, now)!;
  return Number(record.id);
}

/** Recomputed evidence never overwrites a human decision (accepted/rejected/ambiguous). */
export function upsertCompanyMatch(db: DatabaseSync, corporationId: number, companyId: number, assessment: MatchAssessment, runId: number | null = null) {
  const fields = ["match_method", "name_similarity", "location_match", "provider_confidence", "match_confidence",
    "exact_name_match", "city_match", "province_match", "alternate_name_match"] as const;
  const columns = ["corporation_id", "company_id", ...fields, "evidence_json", "enrichment_run_id", "created_at", "updated_at"];
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO corporation_company_matches (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})
    ON CONFLICT(corporation_id,company_id) DO UPDATE SET ${[...fields, "evidence_json", "enrichment_run_id", "updated_at"].map(f => `${f}=excluded.${f}`).join(",")}
    RETURNING id`).get(corporationId, companyId,
      ...fields.map(field => typeof assessment[field] === "boolean" ? Number(assessment[field]) : assessment[field]),
      JSON.stringify(assessment.evidence), runId, now, now)!;
  return Number(result.id);
}

export type MatchStatus = "candidate" | "accepted" | "rejected" | "ambiguous";
export function setMatchStatus(db: DatabaseSync, matchId: number, status: MatchStatus) {
  const result = db.prepare("UPDATE corporation_company_matches SET match_status=?,updated_at=? WHERE id=?")
    .run(status, new Date().toISOString(), matchId);
  if (!result.changes) throw new Error("Match not found.");
}

type Config = null | boolean | number | string | Config[] | { [key: string]: Config };
function canonicalConfig(value: Config): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Config numbers must be finite.");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalConfig).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalConfig(value[key])}`).join(",")}}`;
}
export function enrichmentConfigHash(config: Config) { return createHash("sha256").update(canonicalConfig(config)).digest("hex"); }

/** Each attempt gets its own audit row; identical configurations get identical hashes. */
export function startEnrichmentRun(db: DatabaseSync, provider: string, version: string, config: Config, notes: string | null = null) {
  if (!provider.trim() || !version.trim()) throw new Error("Provider and version are required.");
  return Number(db.prepare(`INSERT INTO enrichment_runs(provider,version,started_at,config_hash,notes) VALUES(?,?,?,?,?)`)
    .run(provider.trim(), version.trim(), new Date().toISOString(), enrichmentConfigHash(config), notes).lastInsertRowid);
}
export function finishEnrichmentRun(db: DatabaseSync, id: number, result: {
  status: "completed" | "failed"; processed: number; created: number; updated: number; failed: number; notes?: string;
}) {
  const counts = [result.processed, result.created, result.updated, result.failed];
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0) || result.created + result.updated + result.failed > result.processed) {
    throw new Error("Run counters must be nonnegative integers consistent with processed records.");
  }
  const updated = db.prepare(`UPDATE enrichment_runs SET status=?,completed_at=?,records_processed=?,records_created=?,
    records_updated=?,records_failed=?,notes=coalesce(?,notes) WHERE id=? AND status='running'`)
    .run(result.status, new Date().toISOString(), ...counts, result.notes ?? null, id);
  if (!updated.changes) throw new Error("Run not found or already finished.");
}
