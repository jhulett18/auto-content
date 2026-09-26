import { getCarouselSet } from "../../../../lib/references-db";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const carousel = getCarouselSet(id);
  return carousel ? Response.json(carousel) : Response.json({ error: "Carousel not found." }, { status: 404 });
}
