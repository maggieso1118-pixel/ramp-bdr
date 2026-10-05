import { createHash } from "node:crypto";
import { open, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { databasePath, openDatabase } from "../db/database.ts";
import { importCorporations } from "./import.ts";

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
// Current Government of Canada demo snapshot; override for a newer downloaded snapshot.
export const DEFAULT_REGISTRY_SHA256 = "b4745067699dc7880ca193ae45a3b5d36d2350b32cb7f5a65c59a58415464de7";

export class RegistryUploadError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** Streams a browser-selected CSV to a temporary local file, then uses the existing importer. */
export async function importBrowserCsv(
  request: Request, destination = databasePath(),
  allowedSha256: string | null = process.env.BDR_GOVERNMENT_CSV_SHA256 ?? DEFAULT_REGISTRY_SHA256,
) {
  let filename: string;
  try { filename = basename(decodeURIComponent(request.headers.get("x-file-name") ?? "")); }
  catch { throw new RegistryUploadError("Choose a CSV file.", 400); }
  if (!filename.toLowerCase().endsWith(".csv") || filename.length > 200 || filename === ".csv") {
    throw new RegistryUploadError("Choose a CSV file (.csv).", 400);
  }
  if (!request.body) throw new RegistryUploadError("The selected file was empty.", 400);
  const claimedSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimedSize) && claimedSize > MAX_UPLOAD_BYTES) {
    throw new RegistryUploadError("This CSV exceeds the 200 MB local upload limit.", 413);
  }

  const directory = await mkdtemp(join(tmpdir(), "bdr-registry-upload-"));
  const path = join(directory, filename);
  let bytes = 0;
  const hash = createHash("sha256");
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_UPLOAD_BYTES) throw new RegistryUploadError("This CSV exceeds the 200 MB local upload limit.", 413);
          hash.update(value);
          let offset = 0;
          while (offset < value.byteLength) {
            const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
            if (!bytesWritten) throw new Error("Could not save the uploaded CSV.");
            offset += bytesWritten;
          }
        }
      } finally { reader.releaseLock(); }
    } finally { await handle.close(); }
    if (!bytes) throw new RegistryUploadError("The selected file was empty.", 400);
    if (allowedSha256 && hash.digest("hex") !== allowedSha256.toLowerCase()) {
      throw new RegistryUploadError("This demo accepts the configured Government of Canada CSV. Choose that file.", 422);
    }

    const db = openDatabase(destination);
    try {
      // The government's exact 18-column header is validated by the same parser used by the CLI.
      // Re-uploading an unchanged CSV does not add or update source rows.
      const report = await importCorporations(db, path, { signal: request.signal });
      const total = Number(db.prepare("SELECT count(*) AS total FROM accounts").get()!.total);
      return { report, total, uploaded_bytes: bytes };
    } finally { db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
