import { isUsableName, isUsefulCity, normalizeCompanyName, normalizeCountry, normalizeRegion, normalizeText, relaxedCompanyName, REGISTRY_VERSION } from "./names.ts";
import type { RegistryIdentity } from "./names.ts";

export const MATCH_VERSION = "match-v1";
export type CommercialIdentity = { name: string | null; hq_city?: string | null; hq_region?: string | null; hq_country?: string | null };

/** Normalized Levenshtein similarity. Long pathological names use exact equality only. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length > 512 || b.length > 512) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

/** Pairwise suggestion only, never an identity assertion or automatic acceptance. */
export function assessCompanyMatch(registry: RegistryIdentity, company: CommercialIdentity, providerConfidence: number | null = null) {
  if (providerConfidence !== null && (!Number.isFinite(providerConfidence) || providerConfidence < 0 || providerConfidence > 1)) {
    throw new Error("Provider confidence must be between 0 and 1.");
  }
  const target = normalizeCompanyName(company.name);
  const names = [normalizeCompanyName(registry.legal_name), normalizeCompanyName(registry.alternate_name)];
  const similarities = names.map(name => isUsableName(name) && isUsableName(target) ? nameSimilarity(name, target) : 0);
  const alternate = similarities[1] > similarities[0];
  const similarity = Math.max(...similarities);
  const exact = similarity === 1;
  const city = normalizeText(registry.city);
  const region = normalizeRegion(registry.province_normalized);
  const country = normalizeCountry(registry.country);
  const targetCity = normalizeText(company.hq_city);
  const targetRegion = normalizeRegion(company.hq_region);
  const targetCountry = normalizeCountry(company.hq_country);
  const countryConflict = Boolean(country && targetCountry && country !== targetCountry);
  const cityMatch = isUsefulCity(city) && isUsefulCity(targetCity) && city === targetCity;
  const provinceMatch = /^[A-Z]{2}$/.test(region) && region === targetRegion;
  const provinceConflict = Boolean(region && targetRegion && region !== targetRegion);
  const cityConflict = Boolean(city && targetCity && city !== targetCity);
  const locationMatch = countryConflict || provinceConflict ? "conflict" : cityMatch && provinceMatch ? "city_province" : provinceMatch ? "province" : "none";
  const relaxedTarget = relaxedCompanyName(company.name);
  const relaxedEqual = isUsableName(relaxedTarget) && [registry.legal_name, registry.alternate_name].some(name => relaxedCompanyName(name) === relaxedTarget);
  const informativeName = names[alternate ? 1 : 0].replace(/\s/g, "").length >= 3 && target.replace(/\s/g, "").length >= 3;
  const strength = informativeName && exact && locationMatch === "city_province" ? "excellent"
    : informativeName && exact && locationMatch === "province" ? "strong"
    : informativeName && similarity >= 0.9 && locationMatch === "city_province" ? "probable" : "weak";
  // Scores express rule strength, not calibrated probabilities. Provider confidence remains separate.
  const confidence = strength === "excellent" ? 0.95 : strength === "strong" ? 0.85 : strength === "probable" ? 0.7
    : locationMatch === "conflict" ? Math.min(0.2, similarity * 0.2) : Math.min(0.45, Math.max(similarity, relaxedEqual ? 0.5 : 0) * 0.45);
  return {
    match_method: exact ? "exact_normalized_name" : relaxedEqual ? "relaxed_name" : "fuzzy_name",
    name_similarity: similarity, location_match: locationMatch, provider_confidence: providerConfidence,
    match_confidence: confidence, match_status: "candidate" as const,
    exact_name_match: exact, city_match: cityMatch, province_match: provinceMatch, alternate_name_match: alternate,
    evidence: { strength, normalization_version: REGISTRY_VERSION, match_version: MATCH_VERSION,
      registry_names: names, company_name: target, matched_name: alternate ? "alternate" : "legal", informative_name: informativeName,
      registry_city: city, company_city: targetCity, registry_region: region, company_region: targetRegion,
      registry_country: country, company_country: targetCountry, country_conflict: countryConflict,
      province_conflict: provinceConflict, city_conflict: cityConflict, relaxed_name_equal: relaxedEqual,
      location_basis: "registered_address_compared_with_reported_headquarters" },
  };
}
export type MatchAssessment = ReturnType<typeof assessCompanyMatch>;
