import { readFile } from "node:fs/promises";
import path from "node:path";
import { getGenerationOutput } from "../../../../../lib/references-db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/generations/[id]/image">,
) {
  const { id } = await context.params;
  const output = getGenerationOutput(id);
  if (!output) return new Response("Generation not found.", { status: 404 });

  try {
    const bytes = await readFile(path.join(process.cwd(), "data", "generations", output.file_name));
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Generated image is unavailable.", { status: 404 });
  }
}
