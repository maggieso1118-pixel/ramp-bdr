import type { DatabaseSync } from "node:sqlite";
import { backfillRegistryProfiles } from "../resolution/profiles.ts";
import { normalizeCompanyName, normalizeText, normalizeRegion, normalizeCountry, REGISTRY_VERSION, isUsableName, isUsefulCity } from "../resolution/names.ts";
import { assessCompanyMatch } from "../resolution/matching.ts";
import type { SourceIdentity } from "./types.ts";

export function normalizeSourceIdentity(identity: SourceIdentity) {
  return { name: normalizeCompanyName(identity.name), city: normalizeText(identity.city),
    province: normalizeRegion(identity.province), country: normalizeCountry(identity.country),
    postal: (identity.postal ?? "").toUpperCase().replace(/\s/g, "") };
}

/** Explicit batch preparation only; never called by CSV upload or page rendering. */
export function prepareEvidenceCandidates(db: DatabaseSync) {
  backfillRegistryProfiles(db);
  const select = db.prepare(`SELECT a.id,a.city,a.province_normalized,a.updated_at FROM accounts a
    LEFT JOIN evidence_registry_locations l ON l.corporation_id=a.id
    WHERE a.id>? AND (l.corporation_id IS NULL OR l.source_updated_at!=a.updated_at OR l.version!=?) ORDER BY a.id LIMIT 1000`);
  const save = db.prepare(`INSERT INTO evidence_registry_locations VALUES(?,?,?,?,?) ON CONFLICT(corporation_id)
    DO UPDATE SET city=excluded.city,province=excluded.province,source_updated_at=excluded.source_updated_at,version=excluded.version`);
  let after = 0;
  while (true) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = select.all(after, REGISTRY_VERSION);
      for (const row of rows) save.run(row.id, normalizeText(row.city as string | null),
        normalizeRegion(row.province_normalized as string | null), row.updated_at, REGISTRY_VERSION);
      db.exec("COMMIT");
      if (!rows.length) break;
      after = Number(rows.at(-1)!.id);
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
}

type Candidate = { id: number; legal_name: string | null; alternate_name: string | null; city: string | null;
  province_normalized: string | null; country: string | null; postal_code_normalized: string | null };
const fields = "a.id,a.legal_name,a.alternate_name,a.city,a.province_normalized,a.country,a.postal_code_normalized";
const fresh = "p.version=? AND p.source_updated_at=a.updated_at AND p.is_candidate=1";

export function matchSourceIdentity(db: DatabaseSync, source: SourceIdentity) {
  const normalized = normalizeSourceIdentity(source);
  const exactLimit = 100;
  const locationLimit = 1000;
  let candidates: Candidate[] = [];
  let truncated = false;
  if (isUsableName(normalized.name)) {
    candidates = db.prepare(`SELECT ${fields} FROM accounts a JOIN registry_profiles p ON p.corporation_id=a.id
      WHERE ${fresh} AND (p.normalized_legal_name=? OR (p.normalized_alternate_name!='' AND p.normalized_alternate_name=?))
      ORDER BY a.id LIMIT ?`).all(REGISTRY_VERSION, normalized.name, normalized.name, exactLimit + 1) as Candidate[];
    truncated = candidates.length > exactLimit;
    candidates = candidates.slice(0, exactLimit);
    // Fuzzy lookup is bounded by a normalized city/province index, never a full registry comparison.
    if (!candidates.length && isUsefulCity(source.city) && /^[A-Z]{2}$/.test(normalized.province)) {
      candidates = db.prepare(`SELECT ${fields} FROM evidence_registry_locations l JOIN accounts a ON a.id=l.corporation_id
        JOIN registry_profiles p ON p.corporation_id=a.id WHERE l.city=? AND l.province=? AND ${fresh}
        AND l.source_updated_at=a.updated_at AND l.version=? ORDER BY a.id LIMIT ?`)
        .all(normalized.city, normalized.province, REGISTRY_VERSION, REGISTRY_VERSION, locationLimit + 1) as Candidate[];
      truncated = candidates.length > locationLimit;
      candidates = candidates.slice(0, locationLimit);
    }
  }
  const matches = candidates.map(record => {
    const assessment = assessCompanyMatch(record, { name: source.name, hq_city: source.city,
      hq_region: source.province, hq_country: source.country });
    const registryPostal = (record.postal_code_normalized ?? "").replace(/\s/g, "").toUpperCase();
    const postalComparable = /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(normalized.postal) && /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(registryPostal);
    return { corporationId: record.id, assessment,
      explanation: { ...assessment.evidence, source_name: source.name, normalized_source_name: normalized.name,
        registry_name: record.legal_name, registry_alternate_name: record.alternate_name,
        alternate_name_match: assessment.alternate_name_match, name_similarity: assessment.name_similarity,
        city_match: assessment.city_match, province_match: assessment.province_match,
        postal_match: postalComparable ? normalized.postal === registryPostal : null,
        source_postal: source.postal ?? null, registry_postal: record.postal_code_normalized,
        retrieval_truncated: truncated, location_basis: "registered_address_compared_with_source_reported_location" },
      status: "candidate" as "accepted" | "candidate" | "ambiguous" | "rejected" };
  }).filter(match => match.assessment.name_similarity >= 0.5)
    .sort((a, b) => b.assessment.match_confidence - a.assessment.match_confidence || a.corporationId - b.corporationId);

  const eligible = matches.filter(match => ["excellent", "strong"].includes(match.assessment.evidence.strength)
    && !match.assessment.evidence.city_conflict && !match.assessment.evidence.country_conflict && !match.assessment.evidence.province_conflict);
  const probable = matches.filter(match => match.assessment.evidence.strength === "probable");
  const outcome = truncated || eligible.length > 1 || (!eligible.length && probable.length > 1) ? "ambiguous"
    : eligible.length === 1 ? "accepted" : probable.length === 1 ? "candidate" : "unmatched";
  for (const match of matches) {
    match.status = outcome === "accepted" && match === eligible[0] ? "accepted"
      : outcome === "ambiguous" && (truncated || eligible.includes(match) || probable.includes(match)) ? "ambiguous"
      : probable.includes(match) ? "candidate" : "rejected";
  }
  return { outcome, reason: truncated ? "retrieval_limit_requires_review" : outcome === "accepted" ? "unique_exact_name_and_location"
    : outcome === "ambiguous" ? "multiple_plausible_identities" : outcome === "candidate" ? "fuzzy_match_requires_review" : "no_confident_identity",
    matches, accepted: outcome === "accepted" ? eligible[0] : null };
}
