import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { read, utils } from "xlsx";
import { normalizeSourceIdentity } from "../matching.ts";
import type { BulkEvidenceAdapter, SourceIdentity } from "../types.ts";
import { CANADIAN_IMPORTERS_SOURCE, CANADIAN_IMPORTERS_LABEL } from "../canadian-importers-config.ts";

export const CID_HEADERS = ["CITY-VILLE", "COMPANY-ENTREPRISE", "PROVINCE_ENG", "PROVINCE_FRA",
  "POSTAL_CODE-CODE_POSTAL", "DATA_YEAR-ANNÉE_DES_DONNÉES"] as const;
export const CID_SHEET = "pQRY003_CITY";
export const CID_VERSION = "cid-city-2024-v1";

/** Identifies a normalized name/location group, not a verified corporate entity.
 * No source company ID exists. Keys are independent of row order and filename. */
export function canadianImporterKey(identity: Omit<SourceIdentity, "key">) {
  return createHash("sha256").update(JSON.stringify(normalizeSourceIdentity({ ...identity, key: "" }))).digest("hex");
}

/** The inspected .xls is actually XLSB. SheetJS detects XLS/XLSX/XLSB by content.
 * This small workbook is decoded in memory; the generic runner stages batches on disk. */
export function canadianImportersAdapter(): BulkEvidenceAdapter {
  return {
    source: CANADIAN_IMPORTERS_SOURCE, version: CID_VERSION,
    metadata: { source_label: CANADIAN_IMPORTERS_LABEL, data_year: 2024, sheet: CID_SHEET,
      identity_basis: "normalized_name_city_province_postal", country_basis: "not_supplied",
      row_semantics: "Directory listing, not a shipment or transaction. Repeated listings support one presence observation per identity." },
    signals: [{ signal: "is_importer", operation: "presence" }],
    async *read(path) {
      const file = await stat(path);
      if (file.size > 20 * 1024 * 1024) throw new Error("The CID city workbook exceeds the 20 MiB local reader limit.");
      const workbook = read(await readFile(path), { type: "buffer", cellFormula: true, cellDates: false });
      if (workbook.SheetNames.length !== 1 || workbook.SheetNames[0] !== CID_SHEET) {
        throw new Error(`Expected the inspected CID city sheet ${CID_SHEET}.`);
      }
      const sheet = workbook.Sheets[CID_SHEET];
      const range = utils.decode_range(sheet["!ref"] ?? "A1");
      if (range.s.r !== 0 || range.s.c !== 0 || range.e.c !== 5 || range.e.r > 100000) {
        throw new Error("Unsupported CID worksheet dimensions; expected six columns and at most 100,000 data rows.");
      }
      for (let column = 0; column < CID_HEADERS.length; column++) {
        if (sheet[utils.encode_cell({ r: 0, c: column })]?.v !== CID_HEADERS[column]) {
          throw new Error(`Unsupported CID header in column ${column + 1}. Expected ${CID_HEADERS[column]}.`);
        }
      }
      for (let r = 1; r <= range.e.r; r++) {
        const values = CID_HEADERS.map((_, c) => {
          const cell = sheet[utils.encode_cell({ r, c })];
          if (cell?.f || cell?.t === "e") throw new Error(`CID row ${r + 1} contains a formula or cell error.`);
          return cell?.v ?? null;
        });
        if (values.every(value => value === null || value === "")) continue;
        if (values.slice(0, 5).some(value => value !== null && typeof value !== "string") ||
          !String(values[1] ?? "").trim() || ![2024, "2024"].includes(values[5])) {
          throw new Error(`Invalid CID row ${r + 1}: expected text identity fields, a company name, and data year 2024.`);
        }
        const identity = { name: String(values[1]), city: values[0] as string | null,
          province: values[2] as string | null, postal: values[4] as string | null, country: null };
        // No country column: never assume every importer has a Canadian location.
        yield { identity: { ...identity, key: canadianImporterKey(identity) },
          sourceRowNumber: r + 1, sourceRecordId: `${CID_SHEET}!${r + 1}`,
          raw: Object.fromEntries(CID_HEADERS.map((header, c) => [header, values[c]])),
          attributes: { data_year: 2024 }, observedAt: null };
      }
    },
  };
}
