import { createCarouselSet, listCarouselSets } from "../../../lib/references-db";
import { initializeGfnfStyleReference, resolveOfficialProductAssets } from "../../../lib/product-assets";
import type { DraftContextGroup } from "../../../lib/reference-types";

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
    const targetBrand = typeof payload.targetBrand === "string" ? payload.targetBrand.trim() : "Locked-In Supply";
    if (!targetBrand || targetBrand.length > 80) return Response.json({ error: "Target brand must be between 1 and 80 characters." }, { status: 400 });
    const sourceContext = payload.sourceContext && typeof payload.sourceContext === "object" ? payload.sourceContext as DraftContextGroup : null;
    if (sourceContext && (!sourceContext.key || !Array.isArray(sourceContext.products) || sourceContext.products.some((product) => !product.sku || !product.kind || !Number.isInteger(product.limit)))) return Response.json({ error: "The selected GFNF source brief is invalid." }, { status: 400 });
    if (sourceContext?.products.length && (slideCount !== 3 || sourceContext.products.length !== 3)) return Response.json({ error: "Authentic-product carousels require exactly three slides and three verified products." }, { status: 400 });
    const carousel = createCarouselSet({ name: typeof payload.name === "string" ? payload.name : "Untitled carousel", targetBrand, anchorReferenceId: payload.anchorReferenceId, topicStyleId: payload.topicStyleId, slideCount, subject: typeof payload.subject === "string" ? payload.subject : "Original visual story", sourceContext });
    if (carousel.productAssets.length > 0) await initializeGfnfStyleReference(carousel.id);
    const resolved = carousel.productAssets.length > 0 ? await resolveOfficialProductAssets(carousel.id) : carousel;
    return Response.json(resolved, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Carousel could not be created." }, { status: 400 });
  }
}
