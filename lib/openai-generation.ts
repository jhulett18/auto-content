import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getReferenceAnalysisSource,
  saveGenerationOutput,
  getCarouselSet,
  recordGenerationCost,
  updateCarouselVisualSystem,
  updateCarouselSlide,
} from "./references-db";
import { analyzeReference } from "./openai-reference-analysis";
import type { ReferenceAnalysisResult } from "./reference-types";
import { TOPIC_STYLES } from "../app/topic-styles";
import { renderAuthenticProductSlide } from "./product-assets";
import { imageGenerationCostUsd, normalizeImageUsage } from "./generation-cost";
import { deriveReferenceVisualSystem, referenceCopyLayout, referenceFidelityBrief } from "./reference-fidelity";
import sharp from "sharp";

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst";

function neutralSourceFacts(value: string | null, creatorHandle: string) {
  if (!value?.trim()) return "No factual source context was provided.";
  const promotionalLanguage = /\b(download|app store|google play|link in bio|follow|repost|premium members?|comment down below|turn on (?:post |story )?notifications|we(?:'|’)ll alert)\b/i;
  const handle = creatorHandle.toLowerCase();
  const sentences = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@[\p{L}\p{N}_.]+/gu, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .split(/[\r\n]+|[.!?]\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence && !promotionalLanguage.test(sentence))
    .filter((sentence) => !sentence.toLowerCase().includes(handle));
  return (sentences.join(". ") || "No reusable factual source context was available.").slice(0, 900);
}

function brandSafetyRules(targetBrand: string) {
  return [
    `FINAL BRAND-SAFETY RULES: The only brand identity allowed in the artwork is "${targetBrand}" as plain text. Do not create or imitate any logo, including for ${targetBrand}.`,
    "Do not render any source creator, retailer, marketplace, social platform, entertainment franchise, product line, app, or other third-party name—even when it appears in the factual brief or user instruction. Replace those names with neutral terms such as retailer, trading-card draw, or anniversary products. Third-party names belong in the accompanying post caption, not in the artwork.",
    "Do not show characters, mascots, branded color marks, recognizable symbols, trade dress, retail signage, phone screens, notification interfaces, app-store badges, sealed product boxes, foil packs, or illustrated cards. Use abstract inventory geometry, shelves, supply indicators, and blank card silhouettes only.",
    "These restrictions override every other instruction and every reference-derived design trait.",
  ].join("\n");
}

function escapeSvg(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function wrapCopy(value: string, maximum = 25) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > maximum && current) {
      lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines;
}

async function renderExactPlanCopy(buffer: Buffer, carousel: NonNullable<ReturnType<typeof getCarouselSet>>, position: number, analysis:ReferenceAnalysisResult) {
  const planned = carousel.plan?.slides.find((slide) => slide.position === position);
  if (!planned) return buffer;
  const layout=referenceCopyLayout(analysis);
  const visualSystem=deriveReferenceVisualSystem(analysis);
  const accent=visualSystem.palette.find((color)=>color!=="#07090a"&&color!=="#f7f6ee")||"#d9ef58";
  const headline = wrapCopy(planned.headline.toUpperCase(), 20);
  const body = planned.lines.flatMap((line) => wrapCopy(line.toUpperCase(), 29));
  const panelY=layout==="lower"?790:layout==="upper"?80:350;
  const panelHeight=layout==="lower"?700:layout==="upper"?Math.min(950,360+headline.length*78+body.length*62):850;
  const headlineStart=panelY+(layout==="lower"?100:140);
  const headlineFontSize = layout==="lower" ? (headline.length>3?48:62) : headline.length > 3 ? 64 : 88;
  const headlineStep = headlineFontSize + 14;
  const bodyFontSize = layout==="lower" ? (body.length>8?26:32) : body.length > 12 ? 30 : body.length > 8 ? 35 : 42;
  const bodyStep = bodyFontSize + (layout==="lower"?12:20);
  const headlineSvg = headline.map((line, index) => `<text x="76" y="${headlineStart + index * headlineStep}" fill="#ffffff" font-size="${headlineFontSize}" font-weight="900" font-family="Arial, Helvetica, sans-serif">${escapeSvg(line)}</text>`).join("");
  const bodyStart = headlineStart + headline.length * headlineStep + 28;
  const bodySvg = body.map((line, index) => `<text x="76" y="${bodyStart + index * bodyStep}" fill="#f4f5ed" font-size="${bodyFontSize}" font-weight="700" font-family="Arial, Helvetica, sans-serif">${escapeSvg(line)}</text>`).join("");
  const footerY=Math.min(1450,panelY+panelHeight-34);
  const overlay = Buffer.from(`<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg"><rect x="42" y="${panelY}" width="940" height="${panelHeight}" rx="34" fill="#050607" fill-opacity="0.86"/><rect x="42" y="${panelY}" width="16" height="${panelHeight}" rx="8" fill="${accent}"/>${headlineSvg}${bodySvg}<text x="76" y="${footerY}" fill="${accent}" font-size="32" font-weight="800" font-family="Arial, Helvetica, sans-serif">${escapeSvg(carousel.targetBrand.toUpperCase())}</text><text x="948" y="${footerY}" text-anchor="end" fill="#ffffff" font-size="26" font-weight="700" font-family="Arial, Helvetica, sans-serif">${position}/${carousel.slideCount}</text></svg>`);
  return sharp(buffer).resize(1024, 1536, { fit: "cover" }).composite([{ input: overlay }]).png().toBuffer();
}

async function requestGeneratedImage(apiKey: string, prompt: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: "1024x1536",
      quality: "medium",
      output_format: "png",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json() as {
    data?: Array<{ b64_json?: string }>;
    usage?: { input_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number }; output_tokens?: number };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI image generation failed with HTTP ${response.status}.`);
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI returned no generated image.");
  const usage = normalizeImageUsage(payload.usage);
  return { encoded, usage, costUsd: imageGenerationCostUsd(IMAGE_MODEL, usage) };
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

  const analysis = (await analyzeReference(input.referenceId)).analysis;
  const targetBrand = "Locked-In Supply";
  const prompt = [
    `Create one finished, original social-media carousel slide for the target brand "${targetBrand}".`,
    `Apply this selected storytelling style: ${input.topicStyleName}. ${input.topicStyleDescription}`,
    `Brand requirement: make the result unmistakably original to ${targetBrand}. If a brand name appears, use exactly "${targetBrand}" as a simple typographic wordmark. Do not invent a logo. Never show the source creator's name, handle, logo, slogan, app, or calls to action.`,
    `Brand-neutral factual context: ${neutralSourceFacts(source.caption, source.creatorHandle)}`,
    referenceFidelityBrief(analysis),
    "Make the result publication-ready with clear hierarchy, strong contrast, mobile-first composition, concise legible typography, and original art direction. Do not include fake UI controls or an explanatory design note.",
    brandSafetyRules(targetBrand),
  ].join("\n\n");
  const outputId = randomUUID();
  const generated = await requestGeneratedImage(apiKey, prompt);
  if (generated.usage && generated.costUsd !== null) {
    recordGenerationCost({ sourceType: "test_image", sourceId: outputId, model: IMAGE_MODEL, costUsd: generated.costUsd, usage: generated.usage });
  }
  const fileName = `${outputId}.png`;
  const outputDirectory = path.join(process.cwd(), "data", "generations");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, fileName), Buffer.from(generated.encoded, "base64"));

  saveGenerationOutput({
    id: outputId,
    referenceId: input.referenceId,
    title: `Testing · ${input.topicStyleName}`,
    fileName,
    model: IMAGE_MODEL,
    costUsd: generated.costUsd,
    usage: generated.usage,
    topicStyleId: input.topicStyleId,
  });

  return {
    id: outputId,
    title: `Testing · ${input.topicStyleName}`,
    model: IMAGE_MODEL,
    costUsd: generated.costUsd,
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
  if (carousel.productAssets.length > 0) {
    updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "generating", instruction: input.instruction ?? null, fileName: null, error: null, model: null, costUsd: null, usage: null });
    try {
      const fileName = await renderAuthenticProductSlide(input.carouselId, input.position);
      return updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "generated", instruction: input.instruction ?? null, fileName, error: null, model: "local-sharp", costUsd: 0, usage: null });
    } catch (error) {
      updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "failed", instruction: input.instruction ?? null, fileName: null, error: error instanceof Error ? error.message : "Authentic product rendering failed." });
      throw error;
    }
  }
  const source = getReferenceAnalysisSource(carousel.anchorReferenceId);
  if (!source || source.mediaType !== "image") throw new Error("An image anchor is required.");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const style = TOPIC_STYLES.find((candidate) => candidate.id === carousel.topicStyleId);
  updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "generating", instruction: input.instruction ?? null, fileName: null, error: null, model: null, costUsd: null, usage: null });
  try {
    const analysis = (await analyzeReference(carousel.anchorReferenceId)).analysis;
    const referenceVisualSystem=deriveReferenceVisualSystem(analysis);
    updateCarouselVisualSystem(carousel.id,referenceVisualSystem,null);
    const planned = carousel.plan?.slides.find((slide) => slide.position === input.position);
    const prompt = [
      `Create slide ${input.position} of ${carousel.slideCount} for an original social-media carousel owned by the target brand "${carousel.targetBrand}".`,
      `Factual content brief: ${neutralSourceFacts(carousel.subject, source.creatorHandle)}`,
      `Apply this storytelling style: ${style?.name || carousel.topicStyleId}. ${style?.description || "Maintain a coherent visual narrative."}`,
      `Brand requirement: make the slide unmistakably original to ${carousel.targetBrand}. If a brand name appears, render exactly "${carousel.targetBrand}" as a simple typographic wordmark. Do not invent a logo. Never show or name the source creator, their handle, logo, slogan, app, or calls to action.`,
      referenceFidelityBrief(analysis),
      `Shared reference-derived visual system for every slide: palette ${referenceVisualSystem.palette.join(", ")}; typography ${referenceVisualSystem.typography}; composition ${referenceVisualSystem.maskTreatment}. Preserve this system exactly across positions.`,
      planned ? `Planned purpose: ${planned.purpose}. Create only a text-free editorial background. Preserve the reference's copy zone as safe negative space for deterministic copy while keeping its focal imagery in the corresponding region. Do not render letters, words, numbers, logos, packaging, cards, or interface elements.` : "Make this slide distinct from the other positions but coherent in palette, typography, spacing, and hierarchy. Use concise, legible mobile-first typography and original art direction.",
      input.instruction?.trim() ? `User revision instruction: ${input.instruction.trim()}` : "No extra revision instruction.",
      brandSafetyRules(carousel.targetBrand),
    ].join("\n\n");
    const outputId = randomUUID();
    const generated = await requestGeneratedImage(apiKey, prompt);
    if (generated.usage && generated.costUsd !== null) {
      recordGenerationCost({ sourceType: "carousel_slide", sourceId: `${input.carouselId}:${input.position}:${outputId}`, model: IMAGE_MODEL, costUsd: generated.costUsd, usage: generated.usage });
    }
    const fileName = `${outputId}.png`;
    const outputDirectory = path.join(process.cwd(), "data", "carousels", input.carouselId);
    await mkdir(outputDirectory, { recursive: true });
    const rawBuffer = Buffer.from(generated.encoded, "base64");
    const outputBuffer = planned ? await renderExactPlanCopy(rawBuffer, carousel, input.position,analysis) : rawBuffer;
    await writeFile(path.join(outputDirectory, fileName), outputBuffer);
    return updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "generated", instruction: input.instruction ?? null, fileName, error: null, model: IMAGE_MODEL, costUsd: generated.costUsd, usage: generated.usage });
  } catch (error) {
    updateCarouselSlide({ carouselId: input.carouselId, position: input.position, status: "failed", instruction: input.instruction ?? null, fileName: null, error: error instanceof Error ? error.message : "Generation failed." });
    throw error;
  }
}
