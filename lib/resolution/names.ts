/** Bump this whenever normalization, flags, or candidate rules change. */
export const REGISTRY_VERSION = "registry-v3";

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/[’']/g, "").replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Only trailing legal forms are removed; identity words and Canada survive. */
export function normalizeCompanyName(value: string | null | undefined): string {
  let name = normalizeText(value);
  let previous: string;
  do {
    previous = name;
    name = name.replace(/(?:^| )(?:incorporated|incorporee|incorpore|inc|corporation|corp|limited|limitee|ltd|ltee|llc|ulc|sarl|s a r l|i n c)$/, "").trim();
  } while (name !== previous);
  return name;
}

/** Discovery hint only. Never sufficient for a strong identity match. */
export function relaxedCompanyName(value: string | null | undefined): string {
  const name = normalizeCompanyName(value);
  return /\p{L}/u.test(name.replace(/(?:^| )canada$/, ""))
    ? name.replace(/ canada$/, "") : name;
}

const regions: Record<string, string> = {
  ab: "AB", alberta: "AB", bc: "BC", "british columbia": "BC", "colombie britannique": "BC",
  mb: "MB", manitoba: "MB", nb: "NB", "new brunswick": "NB", "nouveau brunswick": "NB",
  nl: "NL", nf: "NL", "newfoundland and labrador": "NL", "terre neuve et labrador": "NL",
  ns: "NS", "nova scotia": "NS", "nouvelle ecosse": "NS", nt: "NT", "northwest territories": "NT",
  nu: "NU", nunavut: "NU", on: "ON", ontario: "ON", pe: "PE", "prince edward island": "PE",
  qc: "QC", quebec: "QC", sk: "SK", saskatchewan: "SK", yt: "YT", yukon: "YT",
};
export function normalizeRegion(value: string | null | undefined) {
  const text = normalizeText(value);
  return regions[text] ?? text;
}
export function normalizeCountry(value: string | null | undefined) {
  const text = normalizeText(value);
  if (["ca", "can", "canada"].includes(text)) return "CA";
  if (["us", "usa", "united states", "united states of america"].includes(text)) return "US";
  return text;
}

const numbered = /^\d{4,}(?: \d{2,})*(?: (?:canada|ontario|quebec|alberta|british columbia|b c|manitoba|saskatchewan|new brunswick|nova scotia|newfoundland(?: and labrador)?|prince edward island|yukon|nunavut|northwest territories))?$/;
const genericWords = new Set(["canada", "company", "compagnie", "enterprise", "enterprises", "entreprise", "entreprises", "holding", "holdings", "gestion", "management", "investment", "investments", "investissement", "investissements", "services", "service", "group", "groupe", "professional", "professionnelle"]);
export function isNumberedName(name: string) { return numbered.test(name); }
export function isUsableName(name: string) {
  return /\p{L}/u.test(name) && !isNumberedName(name) &&
    !["unknown", "inconnu", "na", "n a", "not available", "none", "null"].includes(name);
}

export function isUsefulCity(value: string | null | undefined) {
  const city = normalizeText(value);
  return (city.match(/\p{L}/gu)?.length ?? 0) >= 2 && !/^[a-z]\d[a-z] ?\d[a-z]\d$/.test(city) &&
    !/^(?:unit|suite|apt|apartment) \d/.test(city) &&
    !["unknown", "inconnu", "na", "n a", "none", "null", "not available"].includes(city);
}

export const FLAG_NAMES = [
  "is_numbered_corporation", "is_professional_corporation", "is_holding_company",
  "is_investment_entity", "is_real_estate_holding_entity", "is_management_company",
  "is_generic_legal_name", "has_alternate_name", "has_useful_location",
] as const;
export type RegistryIdentity = {
  legal_name: string | null; alternate_name?: string | null;
  city?: string | null; province_normalized?: string | null; country?: string | null;
};

export function deriveRegistryIdentity(record: RegistryIdentity) {
  const legal = normalizeCompanyName(record.legal_name);
  const alternate = normalizeCompanyName(record.alternate_name);
  const names = [record.legal_name, record.alternate_name].map(normalizeText);
  const any = (pattern: RegExp) => names.some(name => pattern.test(name));
  const holding = any(/\bholdings?\b|\bsociete de portefeuille\b/);
  const flags = {
    is_numbered_corporation: isNumberedName(legal),
    is_professional_corporation: any(/\b(?:professional|prof|professionnelle) (?:corporation|corp|inc)\b|\bsociete professionnelle\b/),
    is_holding_company: holding,
    // Capital alone and real-estate businesses alone are deliberately insufficient.
    is_investment_entity: any(/\b(?:investments?|investissements?|capital partners|capital management|capital holdings|gestion de capitaux)\b/),
    is_real_estate_holding_entity: holding && any(/\breal estate\b|\bimmobili(?:er|ere|ers|eres)\b/),
    is_management_company: any(/\b(?:management|gestion)\b/),
    is_generic_legal_name: !isUsableName(legal) || legal.replace(/\s/g, "").length < 3 || legal.split(" ").every(word => genericWords.has(word) || /^\d+$/.test(word)),
    has_alternate_name: Boolean(record.alternate_name?.trim()),
    has_useful_location: isUsefulCity(record.city) &&
      /^[A-Z]{2}$/.test(normalizeRegion(record.province_normalized)) &&
      ["", "CA"].includes(normalizeCountry(record.country)),
  };
  const candidate = isUsableName(legal) || isUsableName(alternate);
  return {
    normalized_legal_name: legal, normalized_alternate_name: alternate,
    relaxed_legal_name: relaxedCompanyName(record.legal_name),
    relaxed_alternate_name: relaxedCompanyName(record.alternate_name),
    ...flags, is_candidate: candidate,
    candidate_reason: candidate ? (isUsableName(legal) ? "usable_legal_name" : "usable_alternate_name") : "no_usable_identity",
  };
}
