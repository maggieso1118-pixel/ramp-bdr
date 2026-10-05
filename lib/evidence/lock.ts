import { closeSync, openSync, unlinkSync, writeSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

const memoryLocks = new WeakSet<DatabaseSync>();
/** Serialize CLI and browser evidence runs, including their staging phase. */
export async function withEvidenceImportLock<T>(db: DatabaseSync, run: () => Promise<T>): Promise<T> {
  const path = String(db.prepare("PRAGMA database_list").all().find(row => row.name === "main")?.file ?? "");
  const lockPath = path ? `${path}.evidence-import.lock` : null;
  let handle: number | undefined;
  if (lockPath) {
    try { handle = openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`An evidence import holds ${lockPath}. If a process was interrupted, confirm it has stopped before removing that lock file.`);
      }
      throw error;
    }
  } else {
    if (memoryLocks.has(db)) throw new Error("An evidence import is already running.");
    memoryLocks.add(db);
  }
  try {
    if (handle !== undefined) writeSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await run();
  } finally {
    if (handle !== undefined) { closeSync(handle); unlinkSync(lockPath!); }
    else memoryLocks.delete(db);
  }
}
