import Link from "next/link";
export default function CorporationNotFound() {
  return <main id="main" className="not-found"><span className="eyebrow">RECORD NOT FOUND</span><h1>This corporation isn’t in the local directory.</h1><p>Search the imported records for another corporation number or legal name.</p><Link className="button primary" href="/corporations">Back to corporations</Link></main>;
}
