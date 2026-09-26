import { getCarouselSlideFile, updateCarouselSlide } from "../../../../../../../lib/references-db";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string; position: string }> }) {
  const { id, position } = await params;
  const existing = getCarouselSlideFile(id, Number(position));
  const result = updateCarouselSlide({ carouselId: id, position: Number(position), status: "kept", fileName: existing?.file_name ?? null });
  return result ? Response.json(result) : Response.json({ error: "Carousel not found." }, { status: 404 });
}
