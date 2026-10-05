"use client";
export default function ApplicationError({ reset }: { reset: () => void }) {
  return <main id="main" className="not-found"><h1>The local data isn’t available right now.</h1><p>Check the local import or database, then try again.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
