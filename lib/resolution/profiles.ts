import type { DatabaseSync } from "node:sqlite";
import { deriveRegistryIdentity, FLAG_NAMES, REGISTRY_VERSION } from "./names.ts";
import type { RegistryIdentity } from "./names.ts";

export type ProfileSource = RegistryIdentity & { id: number; updated_at: string };
const fields = ["normalized_legal_name", "normalized_alternate_name", "relaxed_legal_name", "relaxed_alternate_name",
  ...FLAG_NAMES, "is_candidate", "candidate_reason"] as const;

/** Prepare once per import/backfill; source and derived writes share a transaction. */
export function createProfileWriter(db: DatabaseSync) {
  const columns = ["corporation_id", ...fields, "version", "source_updated_at", "derived_at"];
  const statement = db.prepare(`INSERT INTO registry_profiles (${columns.join(",")})
    VALUES (${columns.map(() => "?").join(",")})
    ON CONFLICT(corporation_id) DO UPDATE SET ${columns.slice(1).map(c => `${c}=excluded.${c}`).join(",")}`);
  return (source: ProfileSource) => {
    const derived = deriveRegistryIdentity(source);
    statement.run(source.id, ...fields.map(field => typeof derived[field] === "boolean" ? Number(derived[field]) : derived[field]),
      REGISTRY_VERSION, source.updated_at, new Date().toISOString());
  };
}

/** Keyset batches bound memory. Failed/interrupted runs can restart: fresh rows are skipped. */
export function backfillRegistryProfiles(db: DatabaseSync, options: { batchSize?: number; onProgress?: (count: number) => void } = {}) {
  const size = options.batchSize ?? 1000;
  if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Error("Batch size must be 1–5000.");
  const select = db.prepare(`SELECT a.id, a.legal_name, a.alternate_name, a.city, a.province_normalized, a.country, a.updated_at
    FROM accounts a LEFT JOIN registry_profiles p ON p.corporation_id=a.id
    WHERE a.id > ? AND (p.corporation_id IS NULL OR p.version != ? OR p.source_updated_at != a.updated_at)
    ORDER BY a.id LIMIT ?`);
  const write = createProfileWriter(db);
  let after = 0;
  let processed = 0;
  while (true) {
    // Lock before selecting: a concurrent import cannot make this batch stale before commit.
    db.exec("BEGIN IMMEDIATE");
    let rows: ProfileSource[];
    try {
      rows = select.all(after, REGISTRY_VERSION, size) as ProfileSource[];
      for (const row of rows) write(row);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    if (!rows.length) break;
    after = rows.at(-1)!.id;
    processed += rows.length;
    options.onProgress?.(processed);
  }
  return processed;
}

const fresh = "p.version=? AND p.source_updated_at=a.updated_at";
/** No overall limit/target; call repeatedly with the returned last corporation_id. */
export function getResolutionCandidates(db: DatabaseSync, options: { afterId?: number; limit?: number } = {}) {
  const after = options.afterId ?? 0;
  const limit = options.limit ?? 1000;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error("Use a nonnegative afterId and a limit of 1–5000.");
  }
  return db.prepare(`SELECT a.source_id, a.legal_name, a.alternate_name, a.city, a.province_normalized, a.country, p.*
    FROM registry_profiles p JOIN accounts a ON a.id=p.corporation_id
    WHERE ${fresh} AND p.is_candidate=1 AND p.corporation_id > ? ORDER BY p.corporation_id LIMIT ?`)
    .all(REGISTRY_VERSION, after, limit);
}

export function registryProfileSummary(db: DatabaseSync) {
  const total = Number(db.prepare("SELECT count(*) AS n FROM accounts").get()!.n);
  const summary = db.prepare(`SELECT count(*) AS profiles, coalesce(sum(p.is_candidate),0) AS candidates,
    ${FLAG_NAMES.map(flag => `coalesce(sum(p.${flag}),0) AS ${flag}`).join(",")}
    FROM registry_profiles p JOIN accounts a ON a.id=p.corporation_id WHERE ${fresh}`).get(REGISTRY_VERSION) as
      { profiles: number; candidates: number } & Record<typeof FLAG_NAMES[number], number>;
  return { total, ...summary, missing_or_stale: total - Number(summary.profiles) };
}
