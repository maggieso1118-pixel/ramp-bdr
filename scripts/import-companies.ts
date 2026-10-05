import { resolve } from "node:path";
import { statSync } from "node:fs";
import { databasePath, openDatabase } from "../lib/db/database.ts";
import { importCorporations } from "../lib/corporations/import.ts";

const filename = process.argv[2];
if (!filename || process.argv.length !== 3) {
  console.error("Usage: pnpm import:companies /path/to/corporations-active-cbca-en.csv");
  process.exitCode = 1;
} else {
  const db = openDatabase();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let lastProgress = 0;
  try {
    console.log(`Importing ${resolve(filename)} into ${databasePath()}`);
    const report = await importCorporations(db, resolve(filename), {
      signal: controller.signal,
      onProgress: r => {
        if (r.processed - lastProgress >= 50000) {
          console.log(`${r.processed.toLocaleString()} rows processed · ${r.inserted.toLocaleString()} inserted · ${(r.duration_ms / 1000).toFixed(1)}s`);
          lastProgress = r.processed;
        }
      },
    });
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const count = db.prepare("SELECT count(*) AS count FROM accounts").get()!.count;
    console.log(JSON.stringify({ ...report, database_rows: count,
      database_bytes: statSync(databasePath()).size,
      peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    db.close();
  }
}
