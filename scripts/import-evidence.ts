import { openDatabase } from "../lib/db/database.ts";
import { importBulkEvidence } from "../lib/evidence/import.ts";
import { canadianImportersAdapter } from "../lib/evidence/adapters/canadian-importers.ts";

try {
  const [source, path] = process.argv.slice(2);
  if (source !== "canadian-importers" || !path || process.argv.length !== 4) throw new Error("Usage: pnpm import:evidence canadian-importers /path/to/local-bulk-file");
  const adapter = canadianImportersAdapter();
  const db = openDatabase();
  let lastStage = "";
  let lastCount = -1000;
  try { console.log(JSON.stringify(await importBulkEvidence(db, path, adapter, r => {
    const matched = r.matchedSourceCompanies + r.unmatchedSourceCompanies + r.ambiguousMatches;
    const count = r.stage === "matching_evidence" ? matched : r.rowsProcessed;
    if (r.stage !== lastStage || count - lastCount >= 1000) {
      console.log(`${r.stage}: ${count.toLocaleString()} ${r.stage === "matching_evidence" ? "identities assessed" : "source rows"}`);
      lastStage = r.stage; lastCount = count;
    }
  }), null, 2)); }
  finally { db.close(); }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
