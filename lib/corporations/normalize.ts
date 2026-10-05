export const SOURCE_LABEL = "Government of Canada · Federal corporations (CBCA)";

export const SOURCE_COLUMNS = [
  "Corporation number", "Business number (BN)", "Corporate name - form 1",
  "Corporate name - form 2", "Governing legislation", "Status", "Status Detail",
  "Anniversary date", "Year of last annual filing", "Date of last annual meeting",
  "Street", "Street 2", "City/town", "Province/territory", "Country", "Postal code",
  "Minimum number of directors", "Maximum number of directors",
] as const;

export type SourceColumn = typeof SOURCE_COLUMNS[number];
export type RawCorporation = Record<SourceColumn, string>;

function clean(value: string): string | null {
  return value.trim().replace(/\s+/g, " ") || null;
}

export function normalizeCorporation(raw: RawCorporation) {
  const sourceId = clean(raw["Corporation number"]);
  if (!sourceId) return null;
  const provinceRaw = raw["Province/territory"] || null;
  const provinceCode = clean(raw["Province/territory"])?.toUpperCase() ?? null;
  const postalRaw = raw["Postal code"] || null;
  const compactPostal = clean(raw["Postal code"])?.replace(/\s/g, "").toUpperCase() ?? null;
  // Format only an already plausible Canadian code. Never substitute O/0, etc.
  const postalNormalized = compactPostal && /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(compactPostal)
    ? `${compactPostal.slice(0, 3)} ${compactPostal.slice(3)}`
    : clean(raw["Postal code"]);

  return {
    source_id: sourceId,
    business_number: clean(raw["Business number (BN)"]),
    legal_name: clean(raw["Corporate name - form 1"]),
    alternate_name: clean(raw["Corporate name - form 2"]),
    governing_legislation: clean(raw["Governing legislation"]),
    status: clean(raw["Status"]),
    status_detail: clean(raw["Status Detail"]),
    anniversary_date: clean(raw["Anniversary date"]),
    // Keep dates, years, and counts as source text, including questionable values.
    last_annual_filing_year: clean(raw["Year of last annual filing"]),
    last_annual_meeting_date: clean(raw["Date of last annual meeting"]),
    street: clean(raw["Street"]),
    street_2: clean(raw["Street 2"]),
    city: clean(raw["City/town"]),
    province_raw: provinceRaw,
    province_normalized: provinceCode === "NF" ? "NL" : provinceCode,
    country: clean(raw["Country"]),
    postal_code_raw: postalRaw,
    postal_code_normalized: postalNormalized,
    min_directors: clean(raw["Minimum number of directors"]),
    max_directors: clean(raw["Maximum number of directors"]),
    source: SOURCE_LABEL,
    raw_data: JSON.stringify(raw),
  };
}
