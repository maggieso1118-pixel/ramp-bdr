import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin, Users, Building2, Info, Lightbulb, UserRound, BookOpen } from "lucide-react";
import { demoAccounts, scoreFor, whyFit } from "@/lib/mock/accounts";
import { dimensions, fitFor } from "@/lib/config/icp";

export default async function AccountPage({ params }: { params: Promise<{ id:string }> }) {
  const { id }=await params;
  const account=demoAccounts.find(a=>a.id===id);
  if(!account) notFound();
  const score=scoreFor(account); const fit=fitFor(score); const priority=score>=85;
  return <main id="main" className="detail-main">
    <div className="detail-nav"><Link className="back-link" href="/import/demo"><ChevronLeft size={16}/> All accounts</Link><span className="icp-badge"><span>ICP</span> Ramp Canada</span></div>
    <div className="demo-banner"><Info size={16}/><span><strong>Example account.</strong> Fictional company and research. Scores are illustrative; no live evaluation has run.</span></div>
    <section className="account-heading"><div className={`company-avatar large ${account.color}`}>{account.initials}</div><div className="account-intro"><h1>{account.name}</h1><div className="account-meta"><span><MapPin size={14}/>{account.location}</span><span><Building2 size={14}/>{account.industry}</span><span><Users size={14}/>{account.employees} employees</span></div><p>{account.summary}</p></div><div className="account-score"><div>{score}<span>/100</span></div><span className={`fit-label ${priority?"strong":score>=70?"potential":"weak"}`}>{fit}</span><small>Example ICP score</small></div></section>
    <div className="detail-grid"><section className="detail-card fit-card"><div className="section-eyebrow"><span>01</span> WHY IT FITS</div><h2>{priority?"Complexity worth a conversation.":score>=70?"A few signals worth validating.":"Keep your focus elsewhere."}</h2><p className="section-description">{priority?"The strongest signals in this example account.":score>=70?"Confirm the missing context before prioritizing outreach.":"This example has limited scale and spend complexity."}</p><div className="detail-tags">{whyFit(account).map(tag=><span className="signal-chip" key={tag}>{tag}</span>)}</div><div className="dimension-list">{dimensions.map(d=><div className="dimension" key={d.key}><div><span>{d.label}</span><strong>{account.signals[d.key]}</strong></div><div className="dimension-track"><span style={{width:`${account.signals[d.key]}%`}}/></div></div>)}</div><div className="score-note">Sample component scores · Weighted in code<br/>Live model confidence is not available in this preview.</div></section>
    <div className="detail-right"><section className="detail-card why-now-card"><div className="section-eyebrow"><span>02</span> WHY NOW <Lightbulb size={17}/></div><h2>{account.trigger?"A reason to reach out.":"No current trigger available."}</h2><span className="example-label">{account.trigger?"Illustrative scenario · Not a verified event":"Research needed"}</span><p>{account.trigger || "There is no current event in this sample record. Verify a relevant change before using a “why now” in outreach."}</p>{account.trigger && <a href="#sources" className="evidence-link">View example evidence</a>}</section>
    <section className="detail-card buyer-card"><div className="section-eyebrow"><span>03</span> WHO I’D CONTACT</div><div className="buyer-persona"><span className="buyer-icon"><UserRound size={23} strokeWidth={1.5}/></span><div><h2>{account.buyer}</h2><span>Suggested persona</span></div></div><p>{account.buyerReason}</p><div className="buyer-unavailable">{priority?"Named buyer unavailable. Verify a person before outreach.":"Buyer research deferred until the account is prioritized."}</div></section></div></div>
    <section id="sources" className="sources-section"><div className="section-eyebrow"><BookOpen size={16}/> SOURCES & EVIDENCE</div><p>Mock evidence supplied for this prototype. No external sources have been researched.</p><ol>{account.evidence.map(e=><li key={e}>{e}<span>Sample record</span></li>)}</ol></section>
  </main>;
}
