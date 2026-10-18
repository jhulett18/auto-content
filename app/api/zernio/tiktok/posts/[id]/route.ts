import { zernioRequest } from "../../../../../../lib/zernio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/zernio/tiktok/posts/[id]">) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return Response.json({ error: "Invalid post id." }, { status: 400 });
  try {
    const result = await zernioRequest<{
      post?: {
        _id?: string;
        id?: string;
        status?: string;
        platforms?: Array<{
          platform?: string;
          status?: string;
          platformPostUrl?: string;
          error?: string;
        }>;
      };
    }>(`/posts/${encodeURIComponent(id)}`);
    return Response.json({
      post: result.post ? {
        id: result.post._id ?? result.post.id ?? id,
        status: result.post.status ?? "unknown",
        platforms: (result.post.platforms ?? []).map((platform) => ({
          platform: platform.platform,
          status: platform.status,
          platformPostUrl: platform.platformPostUrl,
          error: platform.error,
        })),
      } : null,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Post status could not be loaded." },
      { status: 502 },
    );
  }
}
