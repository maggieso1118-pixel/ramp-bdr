import type { DatabaseSync } from "node:sqlite";
import type { AggregateSignal, EvidenceValue } from "./types.ts";

/** Definitions belong to an inspected source adapter, not to the generic evidence schema. */
export function aggregateEvidence(db: DatabaseSync, sourceCompanyId: number, definitions: readonly AggregateSignal[]) {
  const values: Array<{ signal: string; value: EvidenceValue; definition: AggregateSignal }> = [];
  for (const definition of definitions) {
    let value: EvidenceValue;
    if (definition.operation === "presence" || definition.operation === "row_count") {
      const n = Number(db.prepare("SELECT count(*) n FROM evidence_source_rows WHERE source_company_id=?").get(sourceCompanyId)!.n);
      value = n === 0 ? null : definition.operation === "presence" ? true : n;
    } else {
      if (!("field" in definition)) throw new Error("Aggregate definition requires a field.");
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(definition.field)) throw new Error("Aggregate fields must be simple attribute keys.");
      const path = `$.${definition.field}`;
      const result = definition.operation === "distinct_count"
        ? db.prepare(`SELECT count(DISTINCT json_extract(attributes_json,?)) n FROM evidence_source_rows
            WHERE source_company_id=? AND json_extract(attributes_json,?) IS NOT NULL AND trim(cast(json_extract(attributes_json,?) AS TEXT))!=''`)
          .get(path, sourceCompanyId, path, path)!
        : db.prepare(`SELECT max(json_extract(attributes_json,?)) n FROM evidence_source_rows
            WHERE source_company_id=? AND json_type(attributes_json,?) IN ('integer','real')`).get(path, sourceCompanyId, path)!;
      value = result.n === null || (definition.operation === "distinct_count" && result.n === 0) ? null : Number(result.n);
    }
    values.push({ signal: definition.signal, value, definition });
  }
  return values;
}
