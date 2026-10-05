import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { startEnrichmentRun, finishEnrichmentRun } from "../resolution/store.ts";
import { REGISTRY_VERSION } from "../resolution/names.ts";
import { MATCH_VERSION } from "../resolution/matching.ts";
import { normalizeSourceIdentity, prepareEvidenceCandidates, matchSourceIdentity } from "./matching.ts";
import { aggregateEvidence } from "./aggregate.ts";
import { upsertEvidence } from "./store.ts";
import { withEvidenceImportLock } from "./lock.ts";
import type { BulkEvidenceAdapter, BulkEvidenceRow, EvidenceImportReport, EvidenceStage, SourceIdentity } from "./types.ts";

/** Local file only. Raw rows stage on disk; a failed attempt cannot replace published evidence. */
export async function importBulkEvidence(db: DatabaseSync, path: string, adapter: BulkEvidenceAdapter,
  onProgress?: (report: EvidenceImportReport) => void) {
  return withEvidenceImportLock(db, () => runBulkEvidence(db, path, adapter, onProgress));
}

async function runBulkEvidence(db: DatabaseSync, path: string, adapter: BulkEvidenceAdapter,
  onProgress?: (report: EvidenceImportReport) => void) {
  if (!adapter.source.trim() || !adapter.version.trim() || !adapter.signals.length) throw new Error("An inspected source adapter and signal definitions are required.");
  if (new Set(adapter.signals.map(s => s.signal)).size !== adapter.signals.length) throw new Error("Signal definitions must be unique.");
  const file = await stat(path);
  if (!file.isFile()) throw new Error("Choose a local bulk file.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const sha = hash.digest("hex");
  const started = performance.now();
  const runId = startEnrichmentRun(db, adapter.source, adapter.version,
    JSON.parse(JSON.stringify({ sha256: sha, signals: adapter.signals, metadata: adapter.metadata ?? {}, normalization: REGISTRY_VERSION, matching: MATCH_VERSION, retrieval: "bulk-v1" })));
  const report: EvidenceImportReport = { runId, source: adapter.source, rowsProcessed: 0, uniqueSourceCompanies: 0,
    matchedSourceCompanies: 0, matchedCorporations: 0, unmatchedSourceCompanies: 0, ambiguousMatches: 0,
    probableMatches: 0, evidenceCreated: 0, evidenceUpdated: 0, evidenceRemoved: 0, durationMs: 0,
    stage: "source_ready", jevStatus: "not_run" };
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO evidence_workflows(run_id,source,filename,file_sha256,adapter_version,stage,created_at,updated_at)
    VALUES(?,?,?,?,?,'source_ready',?,?)`).run(runId, adapter.source, basename(path), sha, adapter.version, now, now);
  const save = (stage: EvidenceStage, error: string | null = null) => {
    report.stage = stage; report.durationMs = Math.round(performance.now() - started);
    db.prepare("UPDATE evidence_workflows SET stage=?,report_json=?,error=?,updated_at=? WHERE run_id=?")
      .run(stage, JSON.stringify(report), error, new Date().toISOString(), runId);
  };
  const findCompany = db.prepare("SELECT id,normalized_identity_json FROM evidence_source_companies WHERE run_id=? AND source_company_key=?");
  const insertCompany = db.prepare(`INSERT INTO evidence_source_companies(run_id,source_company_key,source_identity_json,normalized_identity_json) VALUES(?,?,?,?)`);
  const insertRow = db.prepare(`INSERT INTO evidence_source_rows(source_company_id,row_number,source_record_id,raw_json,attributes_json,observed_at) VALUES(?,?,?,?,?,?)`);
  let batch: BulkEvidenceRow[] = [];
  let publishing = false;
  const flush = () => {
    if (!batch.length) return;
    const before = report.rowsProcessed;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of batch) {
        if (!row.identity.key?.trim() || typeof row.identity.name !== "string") throw new Error("Source adapter must supply a stable company key and name.");
        if (row.observedAt && !Number.isFinite(Date.parse(row.observedAt))) throw new Error("Invalid observed date supplied by source adapter.");
        if (row.sourceRowNumber !== undefined && (!Number.isSafeInteger(row.sourceRowNumber) || row.sourceRowNumber < 1)) {
          throw new Error("Source row numbers must be positive integers.");
        }
        for (const value of Object.values(row.attributes ?? {})) {
          if (value !== null && typeof value !== "string" && typeof value !== "number") throw new Error("Source attributes must be strings, numbers, or null.");
          if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Source numbers must be finite.");
        }
        const normalized = JSON.stringify(normalizeSourceIdentity(row.identity));
        const existing = findCompany.get(runId, row.identity.key);
        if (existing && existing.normalized_identity_json !== normalized) throw new Error(`Conflicting identities share source company key ${row.identity.key}. Inspect source grouping.`);
        const companyId = existing?.id ?? insertCompany.run(runId, row.identity.key, JSON.stringify(row.identity), normalized).lastInsertRowid;
        insertRow.run(companyId, row.sourceRowNumber ?? report.rowsProcessed + 1, row.sourceRecordId ?? null, JSON.stringify(row.raw),
          JSON.stringify(row.attributes ?? {}), row.observedAt ? new Date(row.observedAt).toISOString() : null);
        report.rowsProcessed++;
      }
      save("source_ready");
      db.exec("COMMIT"); batch = [];
    } catch (error) { db.exec("ROLLBACK"); report.rowsProcessed = before; throw error; }
    onProgress?.({ ...report });
  };
  try {
    for await (const row of adapter.read(path)) {
      batch.push(row);
      if (batch.length >= 1000) { flush(); await setImmediate(); }
    }
    flush();
    if (!report.rowsProcessed) throw new Error("The bulk source is empty; existing evidence has been retained.");
    const finalFile = await stat(path);
    if (file.size !== finalFile.size || file.mtimeMs !== finalFile.mtimeMs) throw new Error("Source file changed during import. Retry with a stable file.");
    report.uniqueSourceCompanies = Number(db.prepare("SELECT count(*) n FROM evidence_source_companies WHERE run_id=?").get(runId)!.n);
    save("preparing_candidates"); onProgress?.({ ...report });
    prepareEvidenceCandidates(db);
    save("matching_evidence"); onProgress?.({ ...report });

    db.exec("BEGIN IMMEDIATE"); publishing = true;
    const saveMatch = db.prepare(`INSERT INTO evidence_identity_matches(source_company_id,corporation_id,match_status,match_method,match_confidence,evidence_json) VALUES(?,?,?,?,?,?)`);
    let identitiesProcessed = 0;
    for (const company of db.prepare("SELECT * FROM evidence_source_companies WHERE run_id=? ORDER BY id").iterate(runId)) {
      const identity = JSON.parse(String(company.source_identity_json)) as SourceIdentity;
      const resolution = matchSourceIdentity(db, identity);
      db.prepare("UPDATE evidence_source_companies SET outcome=?,outcome_reason=? WHERE id=?").run(resolution.outcome, resolution.reason, company.id);
      for (const match of resolution.matches) saveMatch.run(company.id, match.corporationId, match.status,
        match.assessment.match_method, match.assessment.match_confidence, JSON.stringify(match.explanation));
      if (resolution.accepted) {
        report.matchedSourceCompanies++;
        const companyId = Number(company.id);
        const observed = db.prepare("SELECT max(observed_at) latest,count(*) n FROM evidence_source_rows WHERE source_company_id=?").get(companyId)!;
        for (const observation of aggregateEvidence(db, companyId, adapter.signals)) {
          if (observation.value === null) continue;
          const written = upsertEvidence(db, { corporationId: resolution.accepted.corporationId,
            source: adapter.source, sourceCompanyKey: identity.key, signal: observation.signal, value: observation.value,
            runId, sourceCompanyId: companyId, observedAt: observed.latest as string | null,
            matchConfidence: resolution.accepted.assessment.match_confidence,
            metadata: { ...adapter.metadata, filename: basename(path), file_sha256: sha, adapter_version: adapter.version,
              source_identity: identity, source_row_count: observed.n, aggregation: observation.definition,
              matching: resolution.accepted.explanation } });
          if (written.created) report.evidenceCreated++; else report.evidenceUpdated++;
        }
      } else if (resolution.outcome === "ambiguous") report.ambiguousMatches++;
      else { report.unmatchedSourceCompanies++; if (resolution.outcome === "candidate") report.probableMatches++; }
      if (++identitiesProcessed % 100 === 0) { onProgress?.({ ...report }); await setImmediate(); }
    }
    // Each adapter owns a complete source snapshot. Publish changes and retire stale signals atomically.
    report.evidenceRemoved = Number(db.prepare("DELETE FROM company_evidence WHERE source=? AND run_id IS NOT NULL AND run_id!=?").run(adapter.source, runId).changes);
    report.matchedCorporations = Number(db.prepare(`SELECT count(DISTINCT m.corporation_id) n FROM evidence_identity_matches m
      JOIN evidence_source_companies c ON c.id=m.source_company_id WHERE c.run_id=? AND m.match_status='accepted'`).get(runId)!.n);
    finishEnrichmentRun(db, runId, { status: "completed", processed: report.rowsProcessed,
      created: report.uniqueSourceCompanies, updated: 0, failed: 0, notes: "Local evidence phase complete. Jev not run; no ICP scores." });
    save("evidence_ready");
    db.exec("COMMIT"); publishing = false;
    return report;
  } catch (error) {
    if (publishing) { db.exec("ROLLBACK"); report.matchedSourceCompanies = 0; report.matchedCorporations = 0;
      report.unmatchedSourceCompanies = 0; report.ambiguousMatches = 0; report.probableMatches = 0;
      report.evidenceCreated = 0; report.evidenceUpdated = 0; report.evidenceRemoved = 0; }
    const message = error instanceof Error ? error.message : "Bulk evidence import failed.";
    finishEnrichmentRun(db, runId, { status: "failed", processed: report.rowsProcessed, created: 0, updated: 0, failed: 0, notes: message });
    save("failed", message);
    throw new Error(`Evidence run ${runId} failed: ${message}`, { cause: error });
  }
}
