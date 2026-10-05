import { UploadArea } from "@/components/upload";
import Link from "next/link";
import { getRegistrySummary } from "@/lib/corporations/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  const { total } = getRegistrySummary();
  return <main id="main" className="home-main">
    <div className="hero-kicker">AI-powered BDR. By Maggie.</div>
    <h1>Turn a list of businesses into a<br /><span>searchable book of business.</span></h1>
    <p className="hero-description">Start with a complete list of federal corporations.<br />Import the source data, then prepare it for ICP enrichment.</p>
    <UploadArea />
    {total > 0 && <p className="existing-registry">Already imported? <Link href="/corporations">Open {total.toLocaleString("en-CA")} corporation records</Link></p>}
  </main>;
}
