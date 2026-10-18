import { uploadProductAsset } from "../../../../../../../lib/product-assets";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request, { params }: { params: Promise<{id:string;assetId:string}> }) {
  try {
    const { id, assetId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a product image." }, { status: 400 });
    return Response.json(await uploadProductAsset(id, assetId, file));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Product upload failed." }, { status: 502 });
  }
}
