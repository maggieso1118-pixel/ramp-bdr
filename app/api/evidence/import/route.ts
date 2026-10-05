import { openDatabase } from "../../../../lib/db/database.ts";
import { importBulkEvidence } from "../../../../lib/evidence/import.ts";
import { canadianImportersAdapter } from "../../../../lib/evidence/adapters/canadian-importers.ts";
import { canadianImportersPath, canadianImportersSetup } from "../../../../lib/evidence/canadian-importers-config.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let importing = false;

/** The local workflow accepts only the configured source, never a browser-supplied path. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Use the local application to start enrichment." }, { status: 403 });
  if (importing) return Response.json({ error: "Evidence matching is already running." }, { status: 409 });
  if (!canadianImportersSetup().available) return Response.json({ error: "The configured Canadian Importers workbook is missing." }, { status: 422 });
  importing = true;
  let disconnected = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => { if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); };
      let db: ReturnType<typeof openDatabase> | undefined;
      try {
        db = openDatabase();
        const report = await importBulkEvidence(db, canadianImportersPath(), canadianImportersAdapter(),
          report => send({ type: "progress", report }));
        send({ type: "completed", report });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "Evidence matching failed. Previous published evidence was retained." });
      } finally {
        db?.close(); importing = false;
        if (!disconnected) controller.close();
      }
    },
    // Finishing the local import after navigation keeps its audit and publication consistent.
    cancel() { disconnected = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
