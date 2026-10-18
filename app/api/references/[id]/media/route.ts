import { readReferenceImage, type ReferenceImageVariant } from "../../../../../lib/reference-media-cache";

export const runtime = "nodejs";

function unavailableImage(kind: ReferenceImageVariant) {
  const width = kind === "thumbnail" ? 720 : 1200;
  const height = kind === "thumbnail" ? 900 : 1200;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#17171b"/><path d="M0 0h${width}v${Math.round(height * .42)}L0 ${Math.round(height * .68)}Z" fill="#202027"/><rect x="${Math.round(width * .12)}" y="${Math.round(height * .38)}" width="${Math.round(width * .76)}" height="${Math.round(height * .24)}" rx="28" fill="#111114" stroke="#35353e" stroke-width="3"/><text x="50%" y="48%" text-anchor="middle" fill="#a5a5af" font-family="Arial, sans-serif" font-size="${Math.round(width * .038)}" font-weight="700">REFERENCE PREVIEW UNAVAILABLE</text><text x="50%" y="54%" text-anchor="middle" fill="#6f6f79" font-family="Arial, sans-serif" font-size="${Math.round(width * .024)}">Open the original post or refresh the source</text></svg>`;
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/references/[id]/media">,
) {
  const { id } = await context.params;
  const kind: ReferenceImageVariant = new URL(request.url).searchParams.get("kind") === "media"
    ? "media"
    : "thumbnail";

  try {
    const image = await readReferenceImage(id, kind);
    return new Response(Uint8Array.from(image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(image.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Reference not found.") {
      const fallback = unavailableImage(kind);
      return new Response(fallback, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff",
          "X-Reference-Media-Fallback": "unavailable",
        },
      });
    }
    return new Response(
      error.message,
      { status: 404 },
    );
  }
}
