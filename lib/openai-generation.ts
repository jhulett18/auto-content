import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getReferenceAnalysisSource,
  saveGenerationOutput,
  getCarouselSet,
  updateCarouselSlide,
} from "./references-db";
import { TOPIC_STYLES } from "../app/topic-styles";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst";

async function downloadReferenceImage(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Reference image URL is not allowed.");

  const response = await fetch(parsed, {
    headers: { Accept: "image/*", "User-Agent": "Auto-Content-Image-Generation/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Reference image download failed with HTTP ${response.status}.`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("Reference image is too large to generate from.");

  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ? contentType
    : "image/jpeg";
  return { buffer, mime };
}

export async function generateTestingImage(input: {
  referenceId: string;
  topicStyleId: string;
  topicStyleName: string;
  topicStyleDescription: string;
}) {
  const source = getReferenceAnalysisSource(input.referenceId);
  if (!source) throw new Error("Reference not found.");
  if (source.mediaType !== "image") throw new Error("Testing image generation requires an image reference.");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const { buffer, mime } = await downloadReferenceImage(source.mediaUrl);
  const prompt = [
    "Create one finished, original social-media carousel slide using the supplied reference image only as visual inspiration.",
    `Apply this selected storytelling style: ${input.topicStyleName}. ${input.topicStyleDescription}`,
    "Preserve the high-level visual energy and useful composition ideas, but do not copy logos, characters, branded artwork, exact wording, packaging, or recognizable intellectual property from the reference.",
    "Make the result feel publication-ready: clear hierarchy, strong contrast, mobile-first composition, and original art direction. Do not include fake UI controls or an explanatory design note in the image.",
    `The source creator is @${source.creatorHandle}; this is an independent original test, not an official post for that creator. Caption context: ${source.caption?.slice(0, 600) || "none"}`,
  ].join("\n\n");

  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", "1024x1536");
  form.append("quality", "medium");
  form.append("output_format", "png");
  form.append("image", new Blob([buffer], { type: mime }), "reference-image");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI image generation failed with HTTP ${response.status}.`);
  }

  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI returned no generated image.");

  const outputId = randomUUID();
  const fileName = `${outputId}.png`;
  const outputDirectory = path.join(process.cwd(), "data", "generations");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, fileName), Buffer.from(encoded, "base64"));

  saveGenerationOutput({
    id: outputId,
    referenceId: input.referenceId,
    title: `Testing · ${input.topicStyleName}`,
    fileName,
    model: IMAGE_MODEL,
    topicStyleId: input.topicStyleId,
  });

  return {
    id: outputId,
    title: `Testing · ${input.topicStyleName}`,
    model: IMAGE_MODEL,
    imageUrl: `/api/generations/${encodeURIComponent(outputId)}/image`,
  };
}

export async function generateCarouselSlide(input: {
  carouselId: string;
  position: number;
  instruction?: string | null;
}) {
  const carousel = getCarouselSet(input.carouselId);
  if (!carousel) throw new Error("Carousel session not found.");
  if (!Number.isInteger(input.position) || input.position < 1 || input.position > carousel.slideCount) throw new Error("Slide position is outside this carousel.");
  const source = getReferenceAnalysisSource(carousel.anchorReferenceId);
  if (!source || source.mediaType !== "image") throw new Error("An image anchor is required.");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const style = TOPIC_STYLES.find((candidate) => candidate.id === carousel.topicStyleId);
  updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "generating", instruction: input.instruction ?? null, fileName: null, error: null });
  try {
    const { buffer, mime } = await downloadReferenceImage(source.mediaUrl);
    const prompt = [
      `Create slide ${input.position} of ${carousel.slideCount} for an original social-media carousel about: ${carousel.subject}.`,
      `Use the supplied image as the visual anchor and apply this storytelling style: ${style?.name || carousel.topicStyleId}. ${style?.description || "Maintain a coherent visual narrative."}`,
      "Generate a new composition with consistent visual DNA—palette, energy, texture, hierarchy, and pacing—but do not reproduce the reference image, exact layout, wording, logos, characters, branded artwork, or packaging.",
      "Make this slide meaningfully different from the anchor and useful in sequence. Use concise, legible mobile-first typography and original art direction.",
      input.instruction?.trim() ? `User revision instruction: ${input.instruction.trim()}` : "No extra revision instruction.",
      `The source creator is @${source.creatorHandle}; this is an independent original carousel. Source context: ${source.caption?.slice(0, 700) || "none"}`,
    ].join("\n\n");
    const form = new FormData();
    form.append("model", IMAGE_MODEL);
    form.append("prompt", prompt);
    form.append("size", "1024x1536");
    form.append("quality", "medium");
    form.append("output_format", "png");
    form.append("image", new Blob([buffer], { type: mime }), "anchor-reference");
    const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(180_000) });
    const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI image generation failed with HTTP ${response.status}.`);
    const encoded = payload.data?.[0]?.b64_json;
    if (!encoded) throw new Error("OpenAI returned no generated image.");
    const outputId = randomUUID();
    const fileName = `${outputId}.png`;
    const outputDirectory = path.join(process.cwd(), "data", "carousels", input.carouselId);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, fileName), Buffer.from(encoded, "base64"));
    return updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "generated", instruction: input.instruction ?? null, fileName, error: null });
  } catch (error) {
    updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "failed", instruction: input.instruction ?? null, fileName: null, error: error instanceof Error ? error.message : "Generation failed." });
    throw error;
  }
}
