import { uploadGeneratedImage, zernioRequest } from "../../../../../lib/zernio";

export const runtime = "nodejs";

type PostRequest = {
  accountId?: string;
  imageUrl?: string;
  title?: string;
  description?: string;
  privacyLevel?: string;
  allowComment?: boolean;
  autoAddMusic?: boolean;
  contentPreviewConfirmed?: boolean;
  expressConsentGiven?: boolean;
  aiLabelAcknowledged?: boolean;
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as PostRequest;
    const accountId = cleanText(input.accountId, 80);
    const imageUrl = cleanText(input.imageUrl, 500);
    const title = cleanText(input.title, 90);
    const description = cleanText(input.description, 4_000);
    const privacyLevel = cleanText(input.privacyLevel, 80);

    if (!accountId || !imageUrl || !title || !description || !privacyLevel) {
      return Response.json({ error: "Account, image, title, caption, and privacy are required." }, { status: 400 });
    }
    if (!input.contentPreviewConfirmed || !input.expressConsentGiven || !input.aiLabelAcknowledged) {
      return Response.json({ error: "Preview confirmation, publishing consent, and AI-label acknowledgement are required." }, { status: 400 });
    }

    const publicUrl = await uploadGeneratedImage(imageUrl);
    const result = await zernioRequest<{
      message?: string;
      post?: { _id?: string; id?: string; status?: string; platforms?: unknown[] };
    }>("/posts", {
      method: "POST",
      body: JSON.stringify({
        content: title,
        mediaItems: [{ url: publicUrl, type: "image" }],
        platforms: [{ platform: "tiktok", accountId }],
        publishNow: true,
        tiktokSettings: {
          privacy_level: privacyLevel,
          allow_comment: input.allowComment === true,
          content_preview_confirmed: true,
          express_consent_given: true,
          media_type: "photo",
          photo_cover_index: 0,
          description,
          auto_add_music: input.autoAddMusic === true,
          commercialContentType: "brand_organic",
          draft: true,
        },
      }),
    });
    return Response.json({
      message: result.message ?? "Photo sent to TikTok Creator Inbox.",
      postId: result.post?._id ?? result.post?.id ?? null,
      status: result.post?.status ?? "submitted",
    }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The TikTok post could not be created." },
      { status: 502 },
    );
  }
}
