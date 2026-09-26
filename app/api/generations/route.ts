import { listCarouselSets, listGenerationLibrary } from "../../../lib/references-db";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ...listGenerationLibrary(), carousels: listCarouselSets() });
}
