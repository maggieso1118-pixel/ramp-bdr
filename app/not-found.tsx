import Link from "next/link";
export default function NotFound(){ return <main id="main" className="not-found"><span className="eyebrow">ACCOUNT NOT FOUND</span><h1>This account isn’t in the sample book.</h1><p>Return to the list to explore the available example accounts.</p><Link className="button primary" href="/import/demo">Back to sample accounts</Link></main>; }
