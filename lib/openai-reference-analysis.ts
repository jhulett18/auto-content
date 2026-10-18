import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ReferenceAnalysisResponse,
  ReferenceAnalysisResult,
} from "./reference-types";
import {
  getReferenceAnalysisSource,
  getStoredReferenceAnalysis,
  saveReferenceAnalysis,
} from "./references-db";
import { readReferenceImage } from "./reference-media-cache";

const runFile = promisify(execFile);
const VIDEO_FRAME_COUNT = 8;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    visualStyle: {
      type: "object",
      additionalProperties: false,
      properties: {
        colorPalette: { type: "array", items: { type: "string" } },
        composition: { type: "string" },
        typography: { type: "string" },
        imagery: { type: "string" },
        lighting: { type: "string" },
        texture: { type: "string" },
      },
      required: [
        "colorPalette",
        "composition",
        "typography",
        "imagery",
        "lighting",
        "texture",
      ],
    },
    contentStrategy: {
      type: "object",
      additionalProperties: false,
      properties: {
        hook: { type: "string" },
        pacing: { type: "string" },
        storyStructure: { type: "string" },
        cta: { type: "string" },
      },
      required: ["hook", "pacing", "storyStructure", "cta"],
    },
    reusablePatterns: { type: "array", items: { type: "string" } },
    avoidCopying: { type: "array", items: { type: "string" } },
    frameNotes: { type: "array", items: { type: "string" } },
  },
  required: [
    "summary",
    "visualStyle",
    "contentStrategy",
    "reusablePatterns",
    "avoidCopying",
    "frameNotes",
  ],
} as const;

async function downloadMedia(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Media URL is not allowed.");

  const response = await fetch(parsed, {
    headers: { "User-Agent": "Auto-Content-Vision-Analysis/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Media download failed with HTTP ${response.status}.`);

  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_MEDIA_BYTES) throw new Error("Reference media is too large to analyze.");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) throw new Error("Reference media is too large to analyze.");
  return { buffer, contentType: response.headers.get("content-type") ?? "" };
}

function webpDataUrl(buffer:Buffer) {
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

async function videoFrameDataUrls(url: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "auto-content-vision-"));
  const videoPath = path.join(directory, "reference.mp4");

  try {
    const { buffer } = await downloadMedia(url);
    await writeFile(videoPath, buffer);

    const probe = await runFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ],
      { timeout: 30_000 },
    );
    const duration = Number(probe.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("The video duration could not be read.");
    }

    const outputPattern = path.join(directory, "frame-%02d.jpg");
    await runFile(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vf",
        `fps=${VIDEO_FRAME_COUNT}/${duration},scale=960:-2:force_original_aspect_ratio=decrease`,
        "-frames:v",
        String(VIDEO_FRAME_COUNT),
        "-q:v",
        "4",
        outputPattern,
      ],
      { timeout: 60_000 },
    );

    const frameNames = (await readdir(directory))
      .filter((name) => /^frame-\d+\.jpg$/.test(name))
      .sort();
    if (!frameNames.length) throw new Error("No video frames could be extracted.");

    return await Promise.all(
      frameNames.map(async (name) => {
        const frame = await readFile(path.join(directory, name));
        return `data:image/jpeg;base64,${frame.toString("base64")}`;
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = Array.isArray((item as { content?: unknown }).content)
        ? ((item as { content: unknown[] }).content ?? [])
        : [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const value = part as { type?: unknown; text?: unknown };
        return value.type === "output_text" && typeof value.text === "string"
          ? [value.text]
          : [];
      });
    })
    .join("\n");
}

export async function analyzeReference(
  referenceId: string,
  options: { refresh?: boolean } = {},
): Promise<ReferenceAnalysisResponse> {
  const source = getReferenceAnalysisSource(referenceId);
  if (!source) throw new Error("Reference not found.");

  const stored = getStoredReferenceAnalysis(referenceId);
  if (stored && !options.refresh) {
    return {
      referenceId,
      mediaType: stored.media_type,
      model: stored.model,
      frameCount: stored.frame_count,
      durationMs: stored.duration_ms,
      cached: true,
      analysis: JSON.parse(stored.result_json) as ReferenceAnalysisResult,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6-luna";
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const startedAt = Date.now();
  let usedVideoCoverFallback = false;
  let images: string[];
  if (source.mediaType === "video") {
    try {
      images = await videoFrameDataUrls(source.mediaUrl);
    } catch {
      images = [webpDataUrl(await readReferenceImage(referenceId,"thumbnail"))];
      usedVideoCoverFallback = true;
    }
  } else {
    images = [webpDataUrl(await readReferenceImage(referenceId,"thumbnail"))];
  }

  const mediaContext = usedVideoCoverFallback
    ? "The video stream could not be decoded, so this analysis is based only on its cover image. Do not infer pacing or unseen events; say when those details cannot be determined."
    : source.mediaType === "video"
      ? `The ${images.length} images are evenly sampled frames in chronological order.`
      : "The image is the selected reference.";
  const prompt = `Analyze this ${source.platform} ${source.mediaType} as a visual reference for an original social-media carousel. Focus on transferable design and storytelling choices, not on reproducing logos, characters, artwork, packaging, or exact wording. Creator: @${source.creatorHandle}. Caption context: ${source.caption?.slice(0, 1200) || "No caption available."} ${mediaContext}`;

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: prompt },
  ];
  images.forEach((imageUrl, index) => {
    if (images.length > 1) {
      content.push({
        type: "input_text",
        text: `Frame ${index + 1} of ${images.length}`,
      });
    }
    content.push({
      type: "input_image",
      image_url: imageUrl,
      detail: source.mediaType === "video" ? "low" : "high",
    });
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      max_output_tokens: 1800,
      text: {
        format: {
          type: "json_schema",
          name: "reference_analysis",
          strict: true,
          schema: analysisSchema,
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const apiError = payload.error as { message?: unknown } | undefined;
    throw new Error(
      typeof apiError?.message === "string"
        ? `OpenAI: ${apiError.message}`
        : `OpenAI request failed with HTTP ${response.status}.`,
    );
  }

  const text = outputText(payload);
  if (!text) throw new Error("OpenAI returned no analysis text.");

  let analysis: ReferenceAnalysisResult;
  try {
    analysis = JSON.parse(text) as ReferenceAnalysisResult;
  } catch {
    throw new Error("OpenAI returned an invalid analysis response.");
  }

  const durationMs = Date.now() - startedAt;
  saveReferenceAnalysis({
    referenceId,
    mediaType: source.mediaType,
    model,
    frameCount: images.length,
    durationMs,
    resultJson: JSON.stringify(analysis),
  });

  return {
    referenceId,
    mediaType: source.mediaType,
    model,
    frameCount: images.length,
    durationMs,
    cached: false,
    analysis,
  };
}
