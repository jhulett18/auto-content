import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getReferenceMedia } from "./references-db";

export type ReferenceImageVariant = "thumbnail" | "media";

const CACHE_DIRECTORY = path.join(process.cwd(), "data", "reference-media");
const CUSTOM_REFERENCE_DIRECTORY = path.join(process.cwd(), "data", "custom-references");
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const inflight = new Map<string, Promise<Buffer>>();
const failedUntil = new Map<string, number>();

function cachePath(id: string, variant: ReferenceImageVariant) {
  const key = createHash("sha256").update(id).digest("hex");
  return path.join(CACHE_DIRECTORY, `${key}-${variant}.webp`);
}

async function readCached(filePath: string) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fetchImage(url: string, width: number, height: number) {
  const parsed = new URL(url);
  let source:Buffer;
  if (parsed.protocol === "custom-reference:") {
    const fileName=decodeURIComponent(parsed.pathname).replace(/^\/+/,"");
    if (!/^[a-z0-9-]+\.(?:webp|png|jpe?g)$/i.test(fileName)) throw new Error("Custom reference path is not allowed.");
    source=await readFile(path.join(CUSTOM_REFERENCE_DIRECTORY,fileName));
  } else {
    if (parsed.protocol !== "https:") throw new Error("Reference image URL is not allowed.");
    const response = await fetch(parsed, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "Auto-Content-Reference-Cache/1.0",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Reference image returned HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) throw new Error("Reference image is too large to cache.");
    source = Buffer.from(await response.arrayBuffer());
  }
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("Reference image is empty or too large to cache.");
  }

  return sharp(source, { failOn: "error" })
    .rotate()
    .resize(width, height, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
}

async function currentPlatformThumbnail(asset: NonNullable<ReturnType<typeof getReferenceMedia>>) {
  if (!asset.post_url) return null;
  const postUrl = new URL(asset.post_url);
  if (postUrl.protocol !== "https:") return null;

  if (asset.platform === "Instagram" && (postUrl.hostname === "instagram.com" || postUrl.hostname.endsWith(".instagram.com"))) {
    return `${postUrl.origin}${postUrl.pathname.replace(/\/$/, "")}/media/?size=l`;
  }

  if (asset.platform === "TikTok" && (postUrl.hostname === "tiktok.com" || postUrl.hostname.endsWith(".tiktok.com"))) {
    const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl.toString())}`, {
      headers: { Accept: "application/json", "User-Agent": "Auto-Content-Reference-Cache/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { thumbnail_url?: unknown };
    if (typeof payload.thumbnail_url !== "string") return null;
    const thumbnailUrl = new URL(payload.thumbnail_url);
    return thumbnailUrl.protocol === "https:" ? thumbnailUrl.toString() : null;
  }

  return null;
}

async function populateReferenceImage(id: string, variant: ReferenceImageVariant, filePath: string) {
  const asset = getReferenceMedia(id);
  if (!asset) throw new Error("Reference not found.");

  // Prefer a permanent post-derived thumbnail because imported CDN signatures expire.
  const recoveredThumbnail = await currentPlatformThumbnail(asset).catch(() => null);
  // Videos deliberately use only their poster. Playback belongs on the source platform.
  const candidates = asset.media_type === "video"
    ? [recoveredThumbnail, asset.thumbnail_url]
    : variant === "media"
      ? [recoveredThumbnail, asset.media_url, asset.thumbnail_url]
      : [recoveredThumbnail, asset.thumbnail_url, asset.media_url];
  const uniqueCandidates = [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
  const dimensions = variant === "thumbnail"
    ? { width: 720, height: 900 }
    : { width: 2048, height: 2048 };
  let lastError: unknown;

  for (const candidate of uniqueCandidates) {
    try {
      const image = await fetchImage(candidate, dimensions.width, dimensions.height);
      await mkdir(CACHE_DIRECTORY, { recursive: true });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, image);
        await rename(temporaryPath, filePath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      return image;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Reference image is unavailable.");
}

export async function readReferenceImage(id: string, variant: ReferenceImageVariant) {
  const filePath = cachePath(id, variant);
  const cached = await readCached(filePath);
  if (cached) return cached;

  const key = `${id}:${variant}`;
  if ((failedUntil.get(key) ?? 0) > Date.now()) {
    throw new Error("Reference image is temporarily unavailable.");
  }

  const pending = inflight.get(key) ?? populateReferenceImage(id, variant, filePath);
  inflight.set(key, pending);
  try {
    const image = await pending;
    failedUntil.delete(key);
    return image;
  } catch (error) {
    failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
    throw error;
  } finally {
    if (inflight.get(key) === pending) inflight.delete(key);
  }
}
