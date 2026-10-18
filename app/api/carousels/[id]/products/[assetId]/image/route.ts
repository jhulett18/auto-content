import { readProductImage } from "../../../../../../../lib/product-assets";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{id:string;assetId:string}> }) {
  const { id, assetId } = await params;
  const kind = new URL(request.url).searchParams.get("kind") === "prepared" ? "prepared" : "original";
  const image = await readProductImage(id, assetId, kind);
  return image ? new Response(image.body, { headers: { "Content-Type": image.contentType, "Cache-Control": "private, max-age=300" } }) : new Response("Product image not found.", { status: 404 });
}
