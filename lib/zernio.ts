import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCarouselSlideFile, getGenerationOutput } from "./references-db";

const ZERNIO_API_BASE = "https://zernio.com/api/v1";

type ZernioErrorBody = {
  error?: string;
  message?: string;
  code?: string;
};

function apiKey() {
  const value = process.env.ZERNIO_API_KEY?.trim();
  if (!value) throw new Error("Zernio is not configured. Add ZERNIO_API_KEY to .env.local.");
  return value;
}

export async function zernioRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ZERNIO_API_BASE}${pathname}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as (T & ZernioErrorBody) | null;
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Zernio request failed (${response.status}).`);
  }
  if (!body) throw new Error("Zernio returned an empty response.");
  return body;
}

function safeFile(baseDirectory: string, fileName: string) {
  if (path.basename(fileName) !== fileName) throw new Error("The generated image path is invalid.");
  return path.join(process.cwd(), "data", baseDirectory, fileName);
}

export async function readGeneratedImage(imageUrl: string) {
  const pathname = new URL(imageUrl, "http://local.invalid").pathname;
  const generation = pathname.match(/^\/api\/generations\/([^/]+)\/image$/);
  if (generation) {
    const id = decodeURIComponent(generation[1]);
    const output = getGenerationOutput(id);
    if (!output) throw new Error("The selected generated image no longer exists.");
    return {
      bytes: await readFile(safeFile("generations", output.file_name)),
      fileName: `${id}.png`,
      contentType: "image/png",
    };
  }

  const slide = pathname.match(/^\/api\/carousels\/([^/]+)\/slides\/(\d+)\/image$/);
  if (slide) {
    const carouselId = decodeURIComponent(slide[1]);
    const position = Number(slide[2]);
    const row = getCarouselSlideFile(carouselId, position);
    if (!row?.file_name) throw new Error("The selected carousel slide no longer exists.");
    return {
      bytes: await readFile(safeFile(path.join("carousels", carouselId), row.file_name)),
      fileName: `${carouselId}-slide-${position}.png`,
      contentType: "image/png",
    };
  }

  throw new Error("Only images saved in the generation library can be sent to TikTok.");
}

export async function uploadGeneratedImage(imageUrl: string) {
  const image = await readGeneratedImage(imageUrl);
  const presigned = await zernioRequest<{ uploadUrl: string; publicUrl: string }>("/media/presign", {
    method: "POST",
    body: JSON.stringify({
      filename: image.fileName,
      contentType: image.contentType,
      size: image.bytes.byteLength,
    }),
  });
  const upload = await fetch(presigned.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": image.contentType },
    body: new Uint8Array(image.bytes),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) throw new Error(`The image upload failed (${upload.status}).`);
  return presigned.publicUrl;
}

export async function scheduleInstagramCarousel(input: { imageUrls: string[]; caption: string; scheduledFor: string }) {
  if (input.imageUrls.length < 2 || input.imageUrls.length > 10) throw new Error("Instagram carousels require 2 to 10 images.");
  const configuredAccountId = process.env.ZERNIO_INSTAGRAM_ACCOUNT_ID?.trim();
  let accountId = configuredAccountId;
  if (!accountId) {
    const accounts = await zernioRequest<{accounts?:Array<{_id?:string;id?:string;platform?:string;isActive?:boolean}>}>("/accounts");
    const account = (accounts.accounts ?? []).find((candidate) => candidate.platform === "instagram" && candidate.isActive !== false);
    accountId = account?._id ?? account?.id;
  }
  if (!accountId) throw new Error("No active Instagram account is connected in Zernio. Set ZERNIO_INSTAGRAM_ACCOUNT_ID or connect one account.");
  const mediaItems = [];
  for (const imageUrl of input.imageUrls) mediaItems.push({ type: "image", url: await uploadGeneratedImage(imageUrl) });
  const result = await zernioRequest<{message?:string;post?:{_id?:string;id?:string;status?:string;scheduledFor?:string}}>("/posts", {
    method: "POST",
    body: JSON.stringify({
      content: input.caption.slice(0, 2_200),
      mediaItems,
      scheduledFor: input.scheduledFor,
      timezone: process.env.AUTOMATION_TIMEZONE?.trim() || "America/New_York",
      platforms: [{ platform: "instagram", accountId, platformSpecificData: { commentsEnabled: true } }],
    }),
  });
  return { postId: result.post?._id ?? result.post?.id ?? null, status: result.post?.status ?? "scheduled", scheduledFor: result.post?.scheduledFor ?? input.scheduledFor, message: result.message ?? "Instagram carousel scheduled." };
}

export async function listScheduledInstagramPosts(from: Date, to: Date) {
  const query = new URLSearchParams({ status:"scheduled", limit:"100", fromDate:from.toISOString(), toDate:to.toISOString() });
  const result = await zernioRequest<{posts?:Array<{_id?:string;id?:string;scheduledFor?:string;platforms?:Array<{platform?:string}>}>}>(`/posts?${query}`);
  return (result.posts ?? [])
    .filter((post) => post.scheduledFor && (!post.platforms?.length || post.platforms.some((platform) => platform.platform === "instagram")))
    .map((post) => ({ id:post._id ?? post.id ?? "", scheduledFor:post.scheduledFor! }));
}

export async function getInstagramBestTimes() {
  const result = await zernioRequest<{slots?:Array<{day_of_week:number;hour:number;avg_engagement:number;post_count:number}>}>(`/analytics/best-time?platform=instagram&source=all`);
  return result.slots ?? [];
}
