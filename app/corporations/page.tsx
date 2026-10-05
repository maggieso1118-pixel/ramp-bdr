import Link from "next/link";
import { Database, Search, ChevronRight } from "lucide-react";
import { getRegistrySummary, searchCorporations } from "@/lib/corporations/queries";
import { getDatabase } from "@/lib/db/database";
import { getEvidenceWorkflow } from "@/lib/evidence/workflow";
import { EvidenceEnrichment } from "@/components/evidence-enrichment";
import type { EvidenceImportReport } from "@/lib/evidence/types";
import { getLikelihoodState } from "@/lib/likelihood/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Corporation directory | BDR Agent / Ramp" };

function pageLink(query: string, province: string, page: number, sort: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (province) params.set("province", province);
  if (page > 1) params.set("page", String(page));
  if (sort === "likelihood") params.set("sort", sort);
  return `/corporations${params.size ? `?${params}` : ""}`;
}

export default async function CorporationsPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; province?: string | string[]; page?: string | string[]; imported?: string | string[]; sort?: string | string[] }>;
}) {
  const params = await searchParams;
  const summary = getRegistrySummary();
  const evidence = getEvidenceWorkflow(getDatabase());
  const likelihood = getLikelihoodState(getDatabase());
  const sort = params.sort === "likelihood" && likelihood.ready ? "likelihood" : "source";
  const results = searchCorporations({
    query: typeof params.q === "string" ? params.q : "",
    province: typeof params.province === "string" ? params.province : "",
    page: typeof params.page === "string" ? Number(params.page) : 1,
    sort,
  });
  const latest = summary.latestImport;
  return <main id="main" className="book-main registry-main">
    <div className="page-topline"><span className="eyebrow">CANADIAN CORPORATION DIRECTORY</span><Link href="/" className="quiet-link">Home</Link></div>
    <div className="book-title"><div><h1>Your Canadian book of business.</h1><p>Federal corporation records with a separate deterministic commercial-likelihood ranking.</p></div><span className="data-mode">Source data</span></div>
    {params.imported === "1" && <p className="registry-notice" role="status">Your CSV has been checked. The directory below shows all corporation records currently stored locally.</p>}
    <section className="import-card" aria-label="Imported corporation summary">
      <div className="import-file"><span className="file-icon"><Database size={25} strokeWidth={1.5}/></span><div><strong>Government of Canada</strong><p>Federal corporations · CBCA</p>{latest && <small className="source-filename">{latest.filename}</small>}</div></div>
      <div className="import-stats"><div className="green-stat"><strong>{summary.total.toLocaleString("en-CA")}</strong><span>Searchable records</span></div><div><strong>Source data</strong><span>No Ramp ICP score</span></div></div>
    </section>
    {summary.total > 0 && <EvidenceEnrichment enabled={evidence.matchingEnabled} coverage={evidence.corporationsWithEvidence}
      latest={evidence.latest ? { stage: String(evidence.latest.stage),
        report: JSON.parse(String(evidence.latest.report_json)) as EvidenceImportReport,
        error: evidence.latest.error ? String(evidence.latest.error) : null } : null} />}
    {latest && latest.status !== "completed" && <p className="registry-notice" role="status">{latest.status === "failed" ? "The latest import did not finish. The directory contains only previously committed records. Re-run the local import to complete it." : "The latest import is in progress or was interrupted. This count reflects the records saved so far; refresh after the import finishes."}</p>}
    {!summary.total ? <section className="detail-card registry-empty"><h2>Import your first corporation file.</h2><p>Choose the Canadian government CSV on the home page to build this directory.</p><Link href="/" className="button primary">Choose CSV</Link></section> : <>
      <form className="registry-search" action="/corporations" method="get">
        {sort === "likelihood" && <input type="hidden" name="sort" value="likelihood" />}
        <label className="registry-search-input"><span className="sr-only">Search corporations</span><Search size={18}/><input name="q" type="search" placeholder="Company, corporation number, business number, or city" defaultValue={results.query} maxLength={120}/></label>
        <label className="province-filter"><span className="sr-only">Province or territory</span><select name="province" defaultValue={results.province}><option value="">All provinces</option>{["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map(code => <option key={code} value={code}>{code}</option>)}</select></label>
        <button type="submit" className="button primary">Search</button>
      </form>
      <p className="search-guidance">Search the beginning of words with at least two characters. Province filtering uses normalized codes, including NF → NL.</p>
      <div className="table-tools"><div className="table-title"><h2>{results.query || results.province ? "Search results" : sort === "likelihood" ? "Commercial likelihood ranking" : "All corporations"}</h2><span aria-live="polite">{results.total.toLocaleString("en-CA")} {results.query || results.province ? "matches" : "records"}</span></div><div className="ranking-tools">{likelihood.ready && <Link className="quiet-link" href={pageLink(results.query, results.province, 1, sort === "likelihood" ? "source" : "likelihood")}>{sort === "likelihood" ? "View source order" : "Rank by commercial likelihood"}</Link>}{(results.query || results.province) && <Link className="quiet-link" href={pageLink("", "", 1, sort)}>Clear search</Link>}</div></div>
      {sort === "likelihood" && <p className="search-guidance">A rules-based estimate of whether a corporation merits further research. Scores do not measure Ramp fit; equal scores follow corporation ID order. Prepared {likelihood.scoredAt?.slice(0, 10)}.</p>}
      {!likelihood.ready && likelihood.scored > 0 && <p className="registry-notice">The commercial-likelihood ranking needs a fresh preparation run after source evidence changes.</p>}
      <div className="table-card">
        <table className={`registry-table ${sort === "likelihood" ? "ranked-table" : ""}`}><thead><tr><th>Legal name</th>{sort === "likelihood" && <th className="likelihood-column">Likelihood</th>}<th className="registry-location">Location</th><th className="registry-number">Corporation no.</th><th className="registry-status">Status</th><th><span className="sr-only">Details</span></th></tr></thead>
          <tbody>{results.accounts.map(account => <tr key={account.source_id}>
            <td><Link prefetch={false} href={`/corporations/${encodeURIComponent(account.source_id)}`} className="company-link"><span><strong>{account.legal_name || account.alternate_name || "Name not provided"}</strong>{account.alternate_name && account.alternate_name !== account.legal_name && <small>{account.alternate_name}</small>}<small className="registry-mobile-meta">{[account.city, account.province_raw].filter(Boolean).join(", ") || "Location not provided"} · {account.source_id}</small>{sort === "likelihood" && <small className="likelihood-reason">{account.likelihood_reason}</small>}</span></Link></td>
            {sort === "likelihood" && <td className="likelihood-column"><strong>{account.likelihood_score}</strong><small>{account.likelihood_label}</small></td>}
            <td className="registry-location">{account.city || "Not provided"}<small>{account.province_raw || "Not provided"}</small></td>
            <td className="registry-number">{account.source_id}</td><td className="registry-status">{account.status || "Not provided"}</td>
            <td className="open-col"><Link prefetch={false} aria-label={`Open corporation ${account.source_id}`} href={`/corporations/${encodeURIComponent(account.source_id)}`}><ChevronRight size={17}/></Link></td>
          </tr>)}</tbody>
        </table>
        {!results.accounts.length && <div className="empty-results"><Search size={24}/><h3>{results.queryTooShort ? "Enter at least two characters" : "No matching corporations"}</h3><p>Try a company name, number, city, or a different province.</p><Link href="/corporations" className="text-button">Clear search</Link></div>}
        <div className="table-bottom"><span>{results.total ? `${((results.page - 1) * results.pageSize + 1).toLocaleString("en-CA")}–${Math.min(results.page * results.pageSize, results.total).toLocaleString("en-CA")} of ${results.total.toLocaleString("en-CA")}` : "0 results"}</span><span>{sort === "likelihood" ? "Deterministic commercial likelihood · No ICP score" : "Source order · No ICP ranking"}</span></div>
      </div>
      {results.totalPages > 1 && <nav className="registry-pagination" aria-label="Corporation pages">
        {results.page > 1 ? <Link className="button secondary" href={pageLink(results.query, results.province, results.page - 1, sort)}>Previous</Link> : <span className="button pagination-disabled" aria-disabled="true">Previous</span>}
        <span>Page {results.page.toLocaleString("en-CA")} of {results.totalPages.toLocaleString("en-CA")}</span>
        {results.page < results.totalPages ? <Link className="button secondary" href={pageLink(results.query, results.province, results.page + 1, sort)}>Next</Link> : <span className="button pagination-disabled" aria-disabled="true">Next</span>}
      </nav>}
    </>}
    <p className="book-footnote">Commercial likelihood prioritizes further research. It does not establish operating-company status or Ramp fit.</p>
  </main>;
}
