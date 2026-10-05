"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, Search, SlidersHorizontal, Check, ChevronRight, Info, X } from "lucide-react";
import { demoImport, rankedAccounts, scoreFor, whyFit } from "@/lib/mock/accounts";
import { fitFor } from "@/lib/config/icp";

export function ProspectBook() {
  const [filename, setFilename] = useState(demoImport.filename);
  const [search, setSearch] = useState("");
  useEffect(() => { try { setFilename(sessionStorage.getItem("demo-import-filename") || demoImport.filename); } catch { /* Use the sample filename. */ } }, []);
  const filtered = rankedAccounts.filter(a => `${a.name} ${a.industry} ${a.location}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <main id="main" className="book-main">
    <div className="page-topline"><span className="eyebrow">YOUR BOOK OF BUSINESS</span><Link className="quiet-link" href="/">Choose another list</Link></div>
    <div className="book-title"><div><h1>A clearer place to start.</h1><p>The right accounts. The reasons that matter.</p></div><span className="icp-badge"><span>ICP</span> Ramp Canada</span></div>
    <div className="demo-banner"><Info size={16} /><span><strong>Sample book.</strong> Fictional accounts, scores, and research. Counts are illustrative; your file has not been parsed.</span></div>
    <section className="import-card" aria-label="Example import summary">
      <div className="import-file"><span className="file-icon"><FileSpreadsheet size={25} strokeWidth={1.5} /></span><div><strong>{filename}</strong><p><Check size={13} /> Preview ready <span>· Sample data</span></p></div></div>
      <div className="import-stats"><div><strong>{demoImport.illustrativeRowCount.toLocaleString("en-CA")}</strong><span>Example records</span></div><div><strong>{demoImport.evaluatedCount}</strong><span>Example evaluations</span></div><div className="green-stat"><strong>{demoImport.strongCount.toString().padStart(2,"0")}</strong><span>Strong fits</span></div></div>
    </section>
    <section className="prospects-section" aria-labelledby="prospects-heading">
      <div className="table-tools"><div className="table-title"><h2 id="prospects-heading">Your priorities</h2><span>{rankedAccounts.length} sample accounts</span></div><div className="search-wrap"><Search size={17} /><input aria-label="Search accounts" placeholder="Search accounts…" value={search} onChange={e=>setSearch(e.target.value)} />{search && <button aria-label="Clear search" onClick={()=>setSearch("")}><X size={15}/></button>}</div></div>
      <div className="table-card"><table><thead><tr><th className="rank-col">#</th><th>Company</th><th>ICP score</th><th className="why-col">Why it fits</th><th className="priority-col">Priority</th><th><span className="sr-only">Details</span></th></tr></thead>
        <tbody>{filtered.map(a => { const score=scoreFor(a); const fit=fitFor(score); const tags=whyFit(a); return <tr key={a.id}><td className="rank-col">{String(rankedAccounts.indexOf(a)+1).padStart(2,"0")}</td><td><Link href={`/account/${a.id}`} className="company-link"><span className={`company-avatar ${a.color}`}>{a.initials}</span><span><strong>{a.name}</strong><small>{a.industry}<span className="location-inline"> · {a.location}</span></small></span></Link></td><td><div className="score-cell"><strong className={score>=85?"score-green":""}>{score}</strong><span className="score-track"><span style={{width:`${score}%`}} /></span></div></td><td className="why-col"><div className="signal-tags">{tags.length ? tags.map(tag=><span key={tag} className="signal-chip">{tag}</span>) : <span className="muted">{score>=70?"Some relevant signals":"Limited complexity"}</span>}</div></td><td className="priority-col"><span className={`fit-label ${fit==="Strong fit"?"strong":fit==="Potential"?"potential":"weak"}`}>{fit==="Strong fit" && <span className="status-dot" />}{fit}</span></td><td className="open-col"><Link href={`/account/${a.id}`} aria-label={`Open ${a.name}`}><ChevronRight size={17}/></Link></td></tr>; })}</tbody>
      </table>{!filtered.length && <div className="empty-results"><Search size={24}/><h3>No matching accounts</h3><p>Try a different company, industry, or city.</p><button className="text-button" onClick={()=>setSearch("")}>Clear search</button></div>}
      <div className="table-bottom"><span>Showing {filtered.length} of {rankedAccounts.length} sample accounts</span><span><SlidersHorizontal size={13}/> Ranked by ICP score</span></div></div>
      <p className="book-footnote">Start with the strongest fits. Research only where it moves a conversation forward.</p>
    </section>
  </main>;
}
