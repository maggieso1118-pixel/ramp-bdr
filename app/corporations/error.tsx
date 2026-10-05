"use client";
export default function CorporationError({ reset }: { reset: () => void }) {
  return <main id="main" className="not-found"><h1>The local directory couldn’t be opened.</h1><p>Check that the database is available, then try again.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
