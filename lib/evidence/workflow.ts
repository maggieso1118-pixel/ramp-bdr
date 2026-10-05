import type { DatabaseSync } from "node:sqlite";
import { canadianImportersSetup } from "./canadian-importers-config.ts";

export function getEvidenceWorkflow(db: DatabaseSync) {
  const coverage = db.prepare("SELECT count(DISTINCT corporation_id) corporations,count(*) observations FROM company_evidence").get()!;
  const latest = db.prepare("SELECT run_id,source,stage,jev_status,report_json,error FROM evidence_workflows ORDER BY run_id DESC LIMIT 1").get();
  const source = canadianImportersSetup();
  return { source, matchingEnabled: source.available, jevStatus: "not_run" as const,
    corporationsWithEvidence: Number(coverage.corporations), observations: Number(coverage.observations), latest: latest ?? null };
}
