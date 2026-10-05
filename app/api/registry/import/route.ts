import { importBrowserCsv, RegistryUploadError } from "@/lib/corporations/browser-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let importing = false;

export async function POST(request: Request) {
  if (importing) return Response.json({ error: "An import is already in progress. Try again when it finishes." }, { status: 409 });
  importing = true;
  try {
    const result = await importBrowserCsv(request);
    return Response.json({ total: result.total, processed: result.report.processed,
      inserted: result.report.inserted, updated: result.report.updated,
      unchanged: result.report.skipped_existing });
  } catch (error) {
    if (error instanceof RegistryUploadError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && /^Import \d+ failed/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    console.error("Registry CSV import failed", error);
    return Response.json({ error: "The CSV could not be imported. Try again." }, { status: 500 });
  } finally { importing = false; }
}
