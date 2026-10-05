import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin, Building2 } from "lucide-react";
import { getCorporation } from "@/lib/corporations/queries";
import type { Metadata } from "next";
import { getDatabase } from "@/lib/db/database";
import { getEvidenceCoverage } from "@/lib/evidence/store";
import { getCommercialLikelihoodScore } from "@/lib/likelihood/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sourceId: string }> }): Promise<Metadata> {
  const { sourceId } = await params;
  const account = getCorporation(sourceId);
  return { title: `${account?.legal_name || "Corporation record"} | BDR Agent / Ramp` };
}

function Field({ label, value }: { label: string; value: string | null }) {
  return <div><dt>{label}</dt><dd>{value ?? <span className="missing-value">Not provided</span>}</dd></div>;
}

export default async function CorporationDetail({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const account = getCorporation(sourceId);
  if (!account) notFound();
  const evidence = getEvidenceCoverage(getDatabase(), { corporationId: account.id });
  const likelihood = getCommercialLikelihoodScore(getDatabase(), account.id);
  const raw: Record<string, string> = JSON.parse(account.raw_data);
  return <main id="main" className="detail-main registry-detail">
    <div className="detail-nav"><Link href="/corporations" className="back-link"><ChevronLeft size={16}/> Corporation directory</Link><span className="data-mode">Source data</span></div>
    <section className="account-heading"><span className="company-avatar large forest"><Building2 size={27} strokeWidth={1.5}/></span><div className="account-intro"><h1>{account.legal_name || account.alternate_name || "Name not provided"}</h1>{account.alternate_name && account.alternate_name !== account.legal_name && <p className="alternate-name">{account.alternate_name}</p>}<div className="account-meta"><span><MapPin size={14}/>{[account.city, account.province_raw, account.country].filter(Boolean).join(", ") || "Location not provided"}</span><span>Corporation {account.source_id}</span></div></div></section>
    <div className="detail-grid">
      {likelihood && <section className="detail-card"><div className="section-eyebrow">COMMERCIAL LIKELIHOOD</div>
        <h2>{likelihood.score}/100 · {likelihood.label}</h2>
        <p className="source-note">{likelihood.summary} This is a deterministic research priority, not a Ramp ICP score.</p>
        <dl className="source-fields">{likelihood.signals.map(signal => <Field key={signal.reason}
          label={`${signal.reason.replaceAll("_", " ")} (${signal.points > 0 ? "+" : ""}${signal.points})`}
          value={signal.explanation} />)}</dl>
        <p className="source-note">Rule version {likelihood.version}. Registry director fields describe legal limits, not actual director counts. Missing importer evidence contributes no points and does not mean “not an importer.”</p>
      </section>}
      <section className="detail-card"><div className="section-eyebrow">COMMERCIAL EVIDENCE</div>
        {evidence.hasEvidence ? evidence.observations.map(item => <div key={item.id}>
          <dl className="source-fields"><Field label={item.signal === "is_importer" ? "Matched importer presence" : item.signal.replaceAll("_", " ")}
            value={typeof item.value === "boolean" ? (item.value ? "Yes" : "No") : String(item.value)} />
            <Field label="Source" value={String(item.metadata.source_label ?? item.source)} />
            <Field label="Data year" value={item.metadata.data_year ? String(item.metadata.data_year) : null} />
          </dl>
          <details className="evidence-provenance"><summary>Workbook rows and match evidence</summary>
            <p className="source-note">{String(item.metadata.filename ?? "Source file")} · {String(item.metadata.sheet ?? "Source sheet")}. Registry locations are registered addresses. Rule confidence is not a measured probability.</p>
            <pre>{JSON.stringify(item.metadata.matching ?? {}, null, 2)}</pre>
            {item.sourceRows.map(row => <div key={row.rowNumber}><strong>Workbook row {row.rowNumber}</strong><pre>{JSON.stringify(row.raw, null, 2)}</pre></div>)}
            {Number(item.metadata.source_row_count) > 25 && <p>Showing the first 25 source rows. The full history is retained locally.</p>}
            <p className="source-note">Source SHA-256: {String(item.metadata.file_sha256 ?? "Not provided")}</p>
          </details>
        </div>)
          : <p className="source-note">No external commercial evidence has been attached yet. This means unknown, not that the company lacks commercial activity.</p>}
        <p className="source-note">Evidence is source information. No Ramp ICP evaluation or score has been calculated.</p>
      </section>
      <section className="detail-card"><div className="section-eyebrow">CORPORATION RECORD</div><dl className="source-fields">
        <Field label="Legal name" value={account.legal_name}/><Field label="Alternate name" value={account.alternate_name}/>
        <Field label="Corporation number" value={account.source_id}/><Field label="Business number (BN)" value={account.business_number}/>
        <Field label="Governing legislation" value={account.governing_legislation}/><Field label="Status" value={account.status}/><Field label="Status detail" value={account.status_detail}/>
      </dl></section>
      <section className="detail-card"><div className="section-eyebrow">REGISTERED ADDRESS</div><dl className="source-fields">
        <Field label="Street" value={account.street}/><Field label="Street 2" value={account.street_2}/><Field label="City / town" value={account.city}/>
        <Field label="Province / territory (source)" value={account.province_raw}/>{account.province_raw !== account.province_normalized && <Field label="Province / territory (normalized)" value={account.province_normalized}/>}
        <Field label="Country" value={account.country}/><Field label="Postal code (source)" value={account.postal_code_raw}/>{account.postal_code_raw !== account.postal_code_normalized && <Field label="Postal code (formatted)" value={account.postal_code_normalized}/>}
      </dl></section>
      <section className="detail-card"><div className="section-eyebrow">FILINGS & DIRECTOR LIMITS</div><dl className="source-fields">
        <Field label="Anniversary date" value={account.anniversary_date}/><Field label="Year of last annual filing" value={account.last_annual_filing_year}/><Field label="Date of last annual meeting" value={account.last_annual_meeting_date}/>
        <Field label="Minimum number of directors" value={account.min_directors}/><Field label="Maximum number of directors" value={account.max_directors}/>
      </dl><p className="source-note">Dates, filing years, and director limits are reproduced as supplied, including unusual values. Director limits are not employee counts.</p></section>
      <section className="detail-card"><div className="section-eyebrow">SOURCE & PROVENANCE</div><dl className="source-fields">
        <Field label="Source" value={account.source}/><Field label="First imported (UTC)" value={account.imported_at}/><Field label="Last changed locally (UTC)" value={account.updated_at}/>
      </dl><p className="source-note">This is a local snapshot of the government CSV. It does not establish prospect fit or provide enrichment.</p><details className="raw-record"><summary>Original source values</summary><dl className="source-fields">{Object.entries(raw).map(([label, value]) => <Field key={label} label={label} value={value || null}/>)}</dl></details></section>
    </div>
  </main>;
}
