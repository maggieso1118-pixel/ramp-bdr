import { openDatabase } from "../lib/db/database.ts";
import { backfillRegistryProfiles, registryProfileSummary } from "../lib/resolution/profiles.ts";

const db = openDatabase();
const start = performance.now();
try {
  const processed = backfillRegistryProfiles(db, { onProgress: count => {
    if (count % 50000 === 0) console.log(`Prepared ${count.toLocaleString()} corporations…`);
  } });
  console.log(JSON.stringify({ refreshed: processed, seconds: (performance.now() - start) / 1000, ...registryProfileSummary(db) }, null, 2));
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
} finally { db.close(); }
