import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const CANADIAN_IMPORTERS_SOURCE = "canadian_importers_database_2024";
export const CANADIAN_IMPORTERS_LABEL = "Canadian Importers Database 2024";
export function canadianImportersPath() {
  return resolve(/* turbopackIgnore: true */ process.env.BDR_CANADIAN_IMPORTERS_PATH || "data/cid-bdic-majorimportersbycity2024.xls");
}
export function canadianImportersSetup() {
  const available = existsSync(canadianImportersPath());
  return { source: CANADIAN_IMPORTERS_SOURCE, name: CANADIAN_IMPORTERS_LABEL, available,
    status: available ? "source_ready" as const : "requires_source_file" as const };
}
