import { createCarouselSet, listCarouselSets } from "../../../lib/references-db";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ carousels: listCarouselSets() });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    if (typeof payload.anchorReferenceId !== "string" || typeof payload.topicStyleId !== "string") return Response.json({ error: "Anchor and topic style are required." }, { status: 400 });
    const slideCount = Number(payload.slideCount);
    if (!Number.isInteger(slideCount) || slideCount < 3 || slideCount > 10) return Response.json({ error: "Slide count must be between 3 and 10." }, { status: 400 });
    const carousel = createCarouselSet({ name: typeof payload.name === "string" ? payload.name : "Untitled carousel", anchorReferenceId: payload.anchorReferenceId, topicStyleId: payload.topicStyleId, slideCount, subject: typeof payload.subject === "string" ? payload.subject : "Original visual story" });
    return Response.json(carousel, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Carousel could not be created." }, { status: 400 });
  }
}
