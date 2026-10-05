import { isUsableName } from "../resolution/names.ts";

export const LIKELIHOOD_VERSION = "commercial-likelihood-v1";
// Freeze the source-year context. A future annual update must bump the rule version.
export const FILING_REFERENCE_YEAR = 2026;
export type LikelihoodSignal = { reason: string; points: number; explanation: string };
export type LikelihoodInput = {
  normalized_legal_name: string; normalized_alternate_name: string;
  is_numbered_corporation: number | boolean; is_professional_corporation: number | boolean;
  is_holding_company: number | boolean; is_investment_entity: number | boolean;
  is_real_estate_holding_entity: number | boolean; is_management_company: number | boolean;
  is_generic_legal_name: number | boolean; has_alternate_name: number | boolean; has_useful_location: number | boolean;
  min_directors: string | null; max_directors: string | null;
  last_annual_filing_year: string | null; has_importer_evidence: number;
};

const commercialTerms = new Set(["software", "technology", "technologies", "systems", "logistics",
  "manufacturing", "foods", "food", "commerce", "retail", "industrial", "solutions", "services",
  "media", "health", "energy", "energie"]);
const commonFirstNames = new Set(["john", "david", "michael", "robert", "james", "paul", "pierre", "jean",
  "marc", "marie", "susan", "sarah", "daniel", "andrew", "richard", "william", "joseph", "thomas"]);
const personalDescriptors = new Set(["consulting", "services", "contracting", "construction", "advisory"]);

function boundedDirectorCount(value: string | null): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) return null;
  const parsed = Number(value);
  // Unusual registry values such as 999999 are not evidence of a large organization.
  return parsed >= 1 && parsed <= 25 ? parsed : null;
}

export function scoreCommercialLikelihood(input: LikelihoodInput) {
  const name = isUsableName(input.normalized_legal_name)
    ? input.normalized_legal_name : input.normalized_alternate_name;
  const words = name.split(" ").filter(Boolean);
  const signals: LikelihoodSignal[] = [];
  const add = (reason: string, points: number, explanation: string) => signals.push({ reason, points, explanation });

  // 40 is a neutral starting point for an already eligible identity, not a company fact.
  add("eligible_identity_baseline", 40, "Usable registry identity; starting score only.");
  if (isUsableName(input.normalized_legal_name)) add("usable_legal_name", 8, "Usable legal name.");
  if (input.has_importer_evidence) add("matched_2024_importer", 18, "Confidently matched to a 2024 Canadian Importers listing.");
  if (input.has_alternate_name && isUsableName(input.normalized_alternate_name)) {
    add("usable_alternate_name", 6, "Usable alternate registered name.");
  }
  const filing = input.last_annual_filing_year;
  if (filing && /^\d{4}$/.test(filing) && Number(filing) >= FILING_REFERENCE_YEAR - 1 &&
    Number(filing) <= FILING_REFERENCE_YEAR) {
    add("recent_annual_filing", 4, "Last annual filing year is 2025 or 2026.");
  }
  if (input.has_useful_location) add("useful_registered_location", 2, "Usable Canadian registered city and province.");
  if ((boundedDirectorCount(input.min_directors) ?? 0) >= 2) {
    add("minimum_directors_two_or_more", 3, "Registry permits a minimum of at least two directors; this is not an actual count.");
  } else if ((boundedDirectorCount(input.max_directors) ?? 0) >= 2) {
    add("multiple_directors_allowed", 1, "Registry permits multiple directors; this is not an actual count.");
  }

  if (words.length >= 1 && words.length <= 3) add("compact_name", 4, "Name has one to three meaningful words after the legal form.");
  else if (words.length === 4) add("four_word_name", 2, "Name has four meaningful words after the legal form.");
  if (name.length >= 4 && name.length <= 25 && !input.is_generic_legal_name &&
    !input.is_holding_company && !input.is_investment_entity) {
    add("concise_distinctive_name", 4, "Concise name without the current generic or vehicle flags.");
  }
  if (words.some(word => commercialTerms.has(word))) {
    add("operating_word_in_name", 3, "Name contains an operating or commercial term; this is lexical evidence only.");
  }

  if (input.is_numbered_corporation) add("numbered_corporation", -22, "Legal name is a numbered corporation.");
  if (input.is_professional_corporation) add("professional_corporation", -11, "Professional-corporation wording.");
  if (input.is_investment_entity) add("investment_entity", -15, "Investment-vehicle wording.");
  if (input.is_holding_company) add("holding_company", -13, "Holding-company wording.");
  if (input.is_real_estate_holding_entity) add("real_estate_holding", -7, "Property wording combined with a holding-company name.");
  if (input.is_generic_legal_name) add("generic_legal_name", -8, "Generic or weak legal identity.");
  if (input.is_management_company) add("management_name", -3, "Management wording alone is weak operating evidence.");
  if (/^\d{1,5} (?:[\p{L}]+ ){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|rue|drive|dr)$/u.test(name)) {
    add("street_address_name", -10, "Name resembles a street address.");
  }
  const digitCount = (name.match(/\d/g) ?? []).length;
  if (digitCount >= 4 && digitCount / Math.max(name.replace(/\s/g, "").length, 1) >= 0.3) {
    add("numeric_heavy_name", -6, "Name contains a high share of digits.");
  }
  if (words.length === 3 && commonFirstNames.has(words[0]) && /^[\p{L}]{3,}$/u.test(words[1]) &&
    personalDescriptors.has(words[2])) {
    add("possible_personal_service_name", -3, "Name resembles a person's first and last name followed by a service descriptor; weak hint only.");
  }
  const raw = signals.reduce((sum, signal) => sum + signal.points, 0);
  const score = Math.min(100, Math.max(0, raw));
  const label = score >= 70 ? "High commercial likelihood" : score >= 55 ? "Medium commercial likelihood" : "Low commercial likelihood";
  const leading = signals.filter(s => s.points > 0 && s.reason !== "eligible_identity_baseline")
    .sort((a, b) => b.points - a.points || a.reason.localeCompare(b.reason))[0];
  const penalty = signals.filter(s => s.points < 0).sort((a, b) => a.points - b.points || a.reason.localeCompare(b.reason))[0];
  const summary = penalty ? `${leading?.explanation ?? "Usable registry identity."} ${penalty.explanation}`
    : leading?.explanation ?? "Usable registry identity; other evidence is limited.";
  return { score, raw, label, summary, signals, name_used: name };
}
