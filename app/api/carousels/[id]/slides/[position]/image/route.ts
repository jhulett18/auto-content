import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCarouselSlideFile } from "../../../../../../../lib/references-db";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; position: string }> }) {
  const { id, position } = await params;
  const row = getCarouselSlideFile(id, Number(position));
  if (!row?.file_name) return new Response("Slide image not found.", { status: 404 });
  try {
    const body = await readFile(path.join(process.cwd(), "data", "carousels", id, row.file_name));
    return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch {
    return new Response("Slide image not found.", { status: 404 });
  }
}
