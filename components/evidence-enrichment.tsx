"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EvidenceImportReport } from "@/lib/evidence/types";

export function EvidenceEnrichment({ enabled, coverage, latest }: {
  enabled: boolean; coverage: number;
  latest: { stage: string; report: EvidenceImportReport | null; error: string | null } | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<EvidenceImportReport | null>(latest?.report ?? null);
  const [error, setError] = useState(latest?.error ?? "");
  async function run() {
    setRunning(true); setError(""); setReport(null);
    try {
      const response = await fetch("/api/evidence/import", { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error || "Could not start evidence matching.");
      if (!response.body) throw new Error("No progress response was received.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let completed = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split("\n"); pending = lines.pop()!;
          for (const line of lines) {
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === "error") throw new Error(event.error);
            setReport(event.report);
            if (event.type === "completed") completed = true;
          }
          if (done) break;
        }
      } finally { reader.releaseLock(); }
      if (!completed) throw new Error("The progress connection ended. Refresh to check the saved import status before retrying.");
    } catch (error) { setError(error instanceof Error ? error.message : "Evidence matching failed."); }
    finally { setRunning(false); router.refresh(); }
  }
  const finished = report?.stage === "evidence_ready";
  const matched = finished ? report.matchedCorporations : coverage;
  return <section className="enrichment-step" aria-label="ICP enrichment evidence stage">
    <div className="enrichment-description"><span className="eyebrow">CANADIAN IMPORTERS DATABASE 2024</span><h2>Enrich for ICP</h2>
      <p>Match the Major Importers by city workbook to corporation names and registered locations. This stage adds importer evidence only. Jev and ICP scoring have not run.</p>
      <p className="evidence-summary">{matched.toLocaleString("en-CA")} corporations have matched importer evidence. Other corporations remain unknown.</p>
      {report && <div className="evidence-progress" role="status" aria-live="polite">
        {report.stage === "source_ready" && `Reading workbook: ${report.rowsProcessed.toLocaleString("en-CA")} rows staged.`}
        {report.stage === "preparing_candidates" && "Preparing registry names and locations…"}
        {report.stage === "matching_evidence" && `Matching source identities: ${(report.matchedSourceCompanies + report.unmatchedSourceCompanies + report.ambiguousMatches).toLocaleString("en-CA")} of ${report.uniqueSourceCompanies.toLocaleString("en-CA")}.`}
        {finished && <><strong>Importer evidence ready.</strong> {report.rowsProcessed.toLocaleString("en-CA")} source rows; {report.matchedSourceCompanies.toLocaleString("en-CA")} accepted identities; {report.ambiguousMatches.toLocaleString("en-CA")} ambiguous; {report.probableMatches.toLocaleString("en-CA")} probable matches awaiting review; {(report.unmatchedSourceCompanies - report.probableMatches).toLocaleString("en-CA")} other unmatched. No ICP evaluation has run.</>}
        {report.stage === "failed" && "The latest evidence run failed. Previously published evidence remains available."}
      </div>}
      {!enabled && <p>The configured 2024 workbook is unavailable. Restore the local source file to run matching.</p>}
      {running && !report && <p role="status">Opening the workbook…</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <button type="button" className="button primary" disabled={!enabled || running} onClick={run}>
      {running ? "Matching importer evidence…" : "Enrich for ICP"}
    </button>
  </section>;
}
