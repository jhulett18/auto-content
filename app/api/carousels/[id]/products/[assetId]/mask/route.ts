import { approveProductMasks } from "../../../../../../../lib/product-assets";
import type { ProductMaskRegion } from "../../../../../../../lib/reference-types";

export const runtime = "nodejs";

function validRegion(value: unknown): value is ProductMaskRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  return typeof region.id === "string" && typeof region.label === "string" && typeof region.kind === "string" && ["x","y","width","height"].every((key) => typeof region[key] === "number" && Number.isFinite(region[key]) && Number(region[key]) >= 0 && Number(region[key]) <= 1);
}

export async function PUT(request: Request, { params }: { params: Promise<{id:string;assetId:string}> }) {
  try {
    const { id, assetId } = await params;
    const payload = await request.json() as { regions?:unknown };
    if (!Array.isArray(payload.regions) || !payload.regions.every(validRegion)) return Response.json({ error: "Mask regions are invalid." }, { status: 400 });
    return Response.json(await approveProductMasks(id, assetId, payload.regions));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mask approval failed." }, { status: 400 });
  }
}
