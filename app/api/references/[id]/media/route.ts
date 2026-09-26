import { getReferenceMedia } from "../../../../../lib/references-db";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: RouteContext<"/api/references/[id]/media">,
) {
  const { id } = await context.params;
  const asset = getReferenceMedia(id);
  if (!asset) return new Response("Reference not found.", { status: 404 });

  const kind = new URL(request.url).searchParams.get("kind");
  const sourceUrl = kind === "thumbnail" ? asset.thumbnail_url : asset.media_url;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return new Response("Reference media URL is invalid.", { status: 502 });
  }

  if (parsedUrl.protocol !== "https:") {
    return new Response("Reference media URL is not allowed.", { status: 502 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(parsedUrl, {
    headers: {
      Accept: kind === "thumbnail" ? "image/*" : "image/*, video/*",
      ...(range ? { Range: range } : {}),
      "User-Agent": "Auto-Content-Reference-Preview/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Reference media is temporarily unavailable.", {
      status: 502,
    });
  }

  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, max-age=300");

  return new Response(upstream.body, { status: upstream.status, headers });
}
