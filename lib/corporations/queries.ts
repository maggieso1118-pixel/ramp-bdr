import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { getDatabase } from "../db/database.ts";
import type { Corporation, CorporationSummary, ImportReport, SearchResult } from "./types.ts";
import { LIKELIHOOD_VERSION } from "../likelihood/score.ts";

export function getRegistrySummary(db = getDatabase()) {
  const total = Number(db.prepare("SELECT count(*) AS count FROM accounts").get()!.count);
  const latestImport = db.prepare("SELECT * FROM imports ORDER BY id DESC LIMIT 1").get() as ImportReport | undefined;
  return { total, latestImport: latestImport ?? null };
}

const listFields = "a.id, a.source_id, a.business_number, a.legal_name, a.alternate_name, a.city, a.province_raw, a.province_normalized, a.country, a.status";

/** Prefix-of-word matching. Terms are data, never executable FTS or SQL syntax. */
export function searchCorporations(
  options: { query?: string; province?: string; page?: number; sort?: "source" | "likelihood" } = {},
  db: DatabaseSync = getDatabase(),
): SearchResult {
  const query = (options.query ?? "").trim().slice(0, 120);
  const province = (options.province ?? "").trim().toUpperCase().slice(0, 2);
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  const queryTooShort = !!query && (tokens.length === 0 || tokens.every(token => token.length < 2));
  const pageSize = 25;
  if (queryTooShort) return { accounts: [], total: 0, page: 1, pageSize, totalPages: 0, query, province, queryTooShort };
  const values: SQLInputValue[] = [];
  const where: string[] = [];
  const ranked = options.sort === "likelihood";
  const from = ranked ? "accounts a JOIN commercial_likelihood_scores s ON s.corporation_id=a.id" : "accounts a";
  if (ranked) { where.push("s.version=? AND s.source_updated_at=a.updated_at"); values.push(LIKELIHOOD_VERSION); }
  if (tokens.length) {
    where.push("a.id IN (SELECT rowid FROM accounts_search WHERE accounts_search MATCH ?)");
    values.push(tokens.map(token => `"${token}"*`).join(" AND "));
  }
  if (province) { where.push("a.province_normalized = ?"); values.push(province); }
  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(db.prepare(`SELECT count(*) AS count FROM ${from} ${filter}`).get(...values)!.count);
  const totalPages = Math.ceil(total / pageSize);
  const requestedPage = Number.isFinite(options.page) ? Math.floor(options.page!) : 1;
  const page = Math.max(1, Math.min(requestedPage, totalPages || 1));
  // Stable source-order pagination. No ICP ranking or model-based ordering.
  const scoreFields = ranked ? ",s.score AS likelihood_score,s.label AS likelihood_label,s.summary AS likelihood_reason" : "";
  const order = ranked ? "s.score DESC,a.id" : "a.id";
  const accounts = db.prepare(`SELECT ${listFields}${scoreFields} FROM ${from} ${filter}
    ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as CorporationSummary[];
  return { accounts, total, page, pageSize, totalPages, query, province, queryTooShort: false };
}

export function getCorporation(sourceId: string, db = getDatabase()) {
  return (db.prepare("SELECT * FROM accounts WHERE source_id=?").get(sourceId) as Corporation | undefined) ?? null;
}
