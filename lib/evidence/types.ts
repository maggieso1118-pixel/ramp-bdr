export type EvidenceValue = string | number | boolean | null;
export type EvidenceTarget = { corporationId?: number | null; companyId?: number | null };
export type SourceIdentity = {
  /** The adapter must define a stable, source-scoped identity after inspecting real data. */
  key: string; sourceId?: string | null; name: string;
  city?: string | null; province?: string | null; country?: string | null; postal?: string | null;
};
export type BulkEvidenceRow = {
  identity: SourceIdentity;
  sourceRecordId?: string | null;
  /** Actual 1-based worksheet/file row, including the header when present. */
  sourceRowNumber?: number;
  raw: Record<string, unknown>;
  /** Only values explicitly observed in the source, never inferred business facts. */
  attributes?: Record<string, string | number | null>;
  observedAt?: string | null;
};
export type AggregateSignal =
  | { signal: string; operation: "presence" | "row_count" }
  | { signal: string; operation: "distinct_count" | "max_number"; field: string };
export type BulkEvidenceAdapter = {
  source: string;
  version: string;
  /** Source-level provenance, e.g. a data year without inventing an exact date. */
  metadata?: Record<string, unknown>;
  /** One import replaces this source's published snapshot after successful completion. */
  signals: readonly AggregateSignal[];
  read(path: string): AsyncIterable<BulkEvidenceRow>;
};
export type EvidenceStage = "source_ready" | "preparing_candidates" | "matching_evidence" | "evidence_ready" | "failed";
export type EvidenceImportReport = {
  runId: number; source: string; rowsProcessed: number; uniqueSourceCompanies: number;
  matchedSourceCompanies: number; matchedCorporations: number; unmatchedSourceCompanies: number;
  ambiguousMatches: number; probableMatches: number; evidenceCreated: number; evidenceUpdated: number;
  evidenceRemoved: number; durationMs: number; stage: EvidenceStage; jevStatus: "not_run";
};
