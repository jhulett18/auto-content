import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type { CarouselProductAsset, ProductMaskRegion } from "./reference-types";
import {
  getCarouselProductAsset,
  getCarouselProductFile,
  getCarouselSet,
  updateCarouselProductAsset,
  updateCarouselVisualSystem,
} from "./references-db";

const MAX_PRODUCT_BYTES = 12 * 1024 * 1024;
const PRODUCT_DIRECTORY = path.join(process.cwd(), "data", "products");

function rgbHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

export async function initializeGfnfStyleReference(carouselId: string) {
  const carousel = getCarouselSet(carouselId);
  const attachment = carousel?.sourceContext?.attachments[0];
  if (!carousel || !attachment) return carousel;
  try {
    const response = await fetch(attachment.url, { headers: { Accept: "image/*", Authorization: `Bearer ${process.env.ALETHEIA_API_TOKEN?.trim() || ""}` }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GFNF style image returned HTTP ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error("GFNF style image was invalid.");
    const stats = await sharp(buffer).resize(128, 128, { fit: "inside" }).stats();
    const dominant = stats.dominant;
    const primary = rgbHex(dominant.r, dominant.g, dominant.b);
    const secondary = rgbHex(Math.min(255, dominant.b + 45), Math.min(255, dominant.g + 25), Math.min(255, dominant.r + 20));
    const directory = path.join(PRODUCT_DIRECTORY, carouselId);
    await mkdir(directory, { recursive: true });
    const fileName = `gfnf-style.${metadata.format === "png" ? "png" : metadata.format === "webp" ? "webp" : "jpg"}`;
    await writeFile(path.join(directory, fileName), buffer);
    return updateCarouselVisualSystem(carouselId, { palette: [primary, secondary, "#081713"], typography: "bold condensed editorial", maskTreatment: "Locked-In Supply cover panels" }, fileName);
  } catch {
    return carousel;
  }
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as {content?:unknown}).content) ? (item as {content:unknown[]}).content : [];
    return content.flatMap((part) => part && typeof part === "object" && (part as {type?:unknown}).type === "output_text" && typeof (part as {text?:unknown}).text === "string" ? [(part as {text:string}).text] : []);
  }).join("\n");
}

async function proposeMasks(buffer: Buffer): Promise<ProductMaskRegion[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const metadata = await sharp(buffer).metadata();
  const format = metadata.format === "png" ? "png" : metadata.format === "webp" ? "webp" : "jpeg";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6-luna",
      input: [{ role: "user", content: [
        { type: "input_text", text: "Find every visible brand name, logo, character illustration, product-set mark, trademarked symbol, and recognizable franchise mark on this product photograph. Return tight normalized bounding rectangles from 0 to 1. Do not mask generic package edges or blank material." },
        { type: "input_image", image_url: `data:image/${format};base64,${buffer.toString("base64")}`, detail: "high" },
      ] }],
      text: { format: { type: "json_schema", name: "product_masks", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: { regions: { type: "array", items: { type: "object", additionalProperties: false, properties: {
          kind: { type: "string", enum: ["brand_name", "logo", "character_art", "set_mark", "symbol", "other"] },
          label: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" },
        }, required: ["kind", "label", "x", "y", "width", "height"] } } }, required: ["regions"],
      } } },
      max_output_tokens: 1800,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error((payload.error as {message?:string}|undefined)?.message || `Mask proposal failed with HTTP ${response.status}.`);
  const parsed = JSON.parse(outputText(payload)) as {regions:Array<Omit<ProductMaskRegion,"id">>};
  return parsed.regions.map((region) => ({ ...region, id: randomUUID(), x: Math.max(0, Math.min(1, region.x)), y: Math.max(0, Math.min(1, region.y)), width: Math.max(.01, Math.min(1, region.width)), height: Math.max(.01, Math.min(1, region.height)) }));
}

async function storeAndPropose(carouselId: string, asset: CarouselProductAsset, buffer: Buffer, sourceKind: CarouselProductAsset["sourceKind"], sourceImageUrl: string | null) {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new Error("Product image must be JPEG, PNG, or WebP.");
  if (buffer.byteLength > MAX_PRODUCT_BYTES) throw new Error("Product image exceeds the 12 MB limit.");
  const directory = path.join(PRODUCT_DIRECTORY, carouselId);
  await mkdir(directory, { recursive: true });
  const fileName = `${asset.id}-original.${metadata.format === "jpeg" ? "jpg" : metadata.format}`;
  await writeFile(path.join(directory, fileName), buffer);
  const masks = await proposeMasks(buffer);
  return updateCarouselProductAsset({ carouselId, assetId: asset.id, status: "mask_review", sourceKind, sourceImageUrl, originalFileName: fileName, masks, error: null });
}

export async function uploadProductAsset(carouselId: string, assetId: string, file: File) {
  const asset = getCarouselProductAsset(carouselId, assetId);
  if (!asset) throw new Error("Product asset was not found.");
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  return storeAndPropose(carouselId, asset, Buffer.from(await file.arrayBuffer()), "upload", null);
}

function officialImageFromHtml(html: string) {
  return html.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
    ?? html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
    ?? null;
}

export async function resolveOfficialProductAssets(carouselId: string) {
  const carousel = getCarouselSet(carouselId);
  if (!carousel) throw new Error("Carousel was not found.");
  for (const asset of carousel.productAssets.filter((candidate) => candidate.status === "resolving")) {
    try {
      const page = await fetch(asset.sourcePageUrl!, { headers: { Accept: "text/html", "User-Agent": "Auto-Content-Product-Resolver/1.0" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const html = await page.text();
      const imageUrl = page.ok ? officialImageFromHtml(html) : null;
      if (!imageUrl) {
        updateCarouselProductAsset({ carouselId, assetId: asset.id, status: "upload_required", error: "The official product page did not expose a usable image. Upload an approved product photo." });
        continue;
      }
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== "https:") throw new Error("Official image URL was not HTTPS.");
      const image = await fetch(parsed, { headers: { Accept: "image/*", "User-Agent": "Auto-Content-Product-Resolver/1.0" }, signal: AbortSignal.timeout(30_000) });
      if (!image.ok) throw new Error(`Official image returned HTTP ${image.status}.`);
      await storeAndPropose(carouselId, asset, Buffer.from(await image.arrayBuffer()), "official_page", imageUrl);
    } catch (error) {
      updateCarouselProductAsset({ carouselId, assetId: asset.id, status: "upload_required", error: error instanceof Error ? error.message : "Official image resolution failed." });
    }
  }
  return getCarouselSet(carouselId)!;
}

export async function approveProductMasks(carouselId: string, assetId: string, masks: ProductMaskRegion[]) {
  const asset = getCarouselProductAsset(carouselId, assetId);
  const file = getCarouselProductFile(carouselId, assetId, "original");
  if (!asset || !file?.file_name) throw new Error("Original product image was not found.");
  if (masks.length === 0) throw new Error("Review and keep at least one trademark mask.");
  const inputPath = path.join(PRODUCT_DIRECTORY, carouselId, file.file_name);
  const source = sharp(inputPath);
  const metadata = await source.metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  const visual = getCarouselSet(carouselId)?.visualSystem;
  const accent = visual?.palette[0] ?? "#d9ef58";
  const surface = visual?.palette[2] ?? "#081713";
  const overlays = masks.map((mask) => {
    const left = Math.max(0, Math.round(mask.x * width));
    const top = Math.max(0, Math.round(mask.y * height));
    const panelWidth = Math.max(8, Math.min(width - left, Math.round(mask.width * width)));
    const panelHeight = Math.max(8, Math.min(height - top, Math.round(mask.height * height)));
    const label = escapeXml(asset.label.toUpperCase());
    return { input: Buffer.from(`<svg width="${panelWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="${Math.min(16, panelHeight / 5)}" fill="${surface}"/><rect x="3" y="3" width="${Math.max(2, panelWidth - 6)}" height="${Math.max(2, panelHeight - 6)}" rx="${Math.min(13, panelHeight / 5)}" fill="none" stroke="${accent}" stroke-width="6"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="${Math.max(12, Math.min(36, panelHeight * .3))}">${label}</text></svg>`), left, top };
  });
  const fileName = `${asset.id}-prepared.png`;
  await source.composite(overlays).png().toFile(path.join(PRODUCT_DIRECTORY, carouselId, fileName));
  return updateCarouselProductAsset({ carouselId, assetId, status: "approved", preparedFileName: fileName, masks, error: null });
}

export async function renderAuthenticProductSlide(carouselId: string, position: number) {
  const carousel = getCarouselSet(carouselId);
  if (!carousel?.plan) throw new Error("This carousel has no structured plan.");
  if (carousel.productAssets.length === 0 || carousel.productAssets.some((asset) => asset.status !== "approved")) throw new Error("Approve every authentic product photo before rendering slides.");
  const plan = carousel.plan.slides.find((slide) => slide.position === position);
  if (!plan) throw new Error("Planned slide was not found.");
  const canvasWidth = 1024;
  const canvasHeight = 1536;
  const [accent, secondary, surface] = carousel.visualSystem?.palette ?? ["#d9ef58", "#43ced0", "#081713"];
  const productKinds = new Set(plan.productKinds);
  const assets = carousel.productAssets.filter((asset) => productKinds.has(asset.kind));
  const imageWidth = assets.length === 1 ? 680 : 280;
  const imageHeight = assets.length === 1 ? 700 : 470;
  const startX = assets.length === 1 ? 172 : 62;
  const gap = assets.length === 1 ? 0 : 30;
  const composites: Array<{input: Buffer; left: number; top: number}> = [];
  for (const [index, asset] of assets.entries()) {
    const file = getCarouselProductFile(carouselId, asset.id, "prepared");
    if (!file?.file_name) throw new Error(`${asset.label} prepared image was not found.`);
    const buffer = await sharp(path.join(PRODUCT_DIRECTORY, carouselId, file.file_name)).resize(imageWidth, imageHeight, { fit: "contain", background: {r:8,g:23,b:19,alpha:1} }).png().toBuffer();
    composites.push({ input: buffer, left: startX + index * (imageWidth + gap), top: 390 });
  }
  const brand = escapeXml(carousel.targetBrand);
  const headline = escapeXml(plan.headline);
  const lines = plan.lines.map((line, index) => `<text x="72" y="${1160 + index * 82}" fill="${index === 0 ? accent : "#ffffff"}" font-family="Arial, sans-serif" font-size="48" font-weight="800">${escapeXml(line)}</text>`).join("");
  const labels = assets.map((asset, index) => `<text x="${startX + index * (imageWidth + gap) + imageWidth / 2}" y="920" text-anchor="middle" fill="${secondary}" font-family="Arial, sans-serif" font-size="30" font-weight="800">${escapeXml(asset.label.toUpperCase())} · LIMIT ${asset.limit}</text>`).join("");
  const base = Buffer.from(`<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${surface}"/><path d="M0 0 L1024 0 L760 350 L0 520 Z" fill="#102a25"/><path d="M650 0 L1024 0 L1024 420 Z" fill="${secondary}" opacity=".28"/><path d="M0 990 L1024 820 L1024 1536 L0 1536 Z" fill="#050b0a"/><rect x="48" y="50" width="928" height="10" fill="${accent}"/><text x="58" y="128" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="800">${brand}</text><text x="58" y="280" fill="${accent}" font-family="Arial, sans-serif" font-size="92" font-weight="900">${headline}</text><text x="62" y="335" fill="${secondary}" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="5">AUTHENTIC PRODUCT PHOTOGRAPHY · SOURCE REVIEWED</text>${labels}${lines}<text x="72" y="1480" fill="#78928b" font-family="Arial, sans-serif" font-size="20">SOURCE-REVIEWED FACTS · NEUTRAL EDITORIAL ARTWORK</text></svg>`);
  const outputId = randomUUID();
  const fileName = `${outputId}.png`;
  const directory = path.join(process.cwd(), "data", "carousels", carouselId);
  await mkdir(directory, { recursive: true });
  await sharp(base).composite(composites).png().toFile(path.join(directory, fileName));
  return fileName;
}

export async function readProductImage(carouselId: string, assetId: string, kind: "original" | "prepared") {
  const row = getCarouselProductFile(carouselId, assetId, kind);
  if (!row?.file_name) return null;
  const extension = path.extname(row.file_name).toLowerCase();
  const contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { body: await readFile(path.join(PRODUCT_DIRECTORY, carouselId, row.file_name)), contentType };
}
