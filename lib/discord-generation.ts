import path from "node:path";
import { createCarouselSet, getCarouselSet, getCarouselSlideFile, updateCarouselSlide } from "./references-db";
import { generateCarouselSlide } from "./openai-generation";
import type { CarouselSet } from "./reference-types";
import { buildDiscordCarouselPlan, DISCORD_GENERATION_SLIDE_COUNT, validateDiscordGenerationTopic } from "./discord-generation-plan";

export { buildDiscordCarouselPlan, DISCORD_GENERATION_SLIDE_COUNT, DISCORD_GENERATION_TOPIC_LIMIT, validateDiscordGenerationTopic } from "./discord-generation-plan";

export type DiscordGenerationProgress = {
  carousel: CarouselSet;
  completed: number;
  total: number;
  position: number | null;
};

export type DiscordGenerationResult = {
  carousel: CarouselSet;
  failedPositions: number[];
};

export function createDiscordCarousel(topic: string, referenceId: string) {
  const cleaned = validateDiscordGenerationTopic(topic);
  return createCarouselSet({
    name: `Discord · ${cleaned.slice(0, 72)}`,
    targetBrand: "Locked-In Supply",
    anchorReferenceId: referenceId,
    topicStyleId: "educational",
    slideCount: DISCORD_GENERATION_SLIDE_COUNT,
    subject: cleaned,
    plan: buildDiscordCarouselPlan(cleaned),
    prepareProductAssets: false,
  });
}

export async function generateDiscordCarousel(input: {
  topic: string;
  referenceId: string;
  onPlanned?: (carousel: CarouselSet) => Promise<void> | void;
  onProgress?: (progress: DiscordGenerationProgress) => Promise<void> | void;
}): Promise<DiscordGenerationResult> {
  const carousel = createDiscordCarousel(input.topic, input.referenceId);
  await input.onPlanned?.(carousel);
  return generateDiscordCarouselPositions({
    carouselId: carousel.id,
    positions: carousel.slides.map((slide) => slide.position),
    onProgress: input.onProgress,
  });
}

export async function retryFailedDiscordSlides(input: {
  carouselId: string;
  onProgress?: (progress: DiscordGenerationProgress) => Promise<void> | void;
}): Promise<DiscordGenerationResult> {
  const carousel = getCarouselSet(input.carouselId);
  if (!carousel) throw new Error("Carousel not found.");
  const positions = carousel.slides.filter((slide) => slide.status === "failed").map((slide) => slide.position);
  if (!positions.length) throw new Error("This carousel has no failed slides to retry.");
  return generateDiscordCarouselPositions({ carouselId: input.carouselId, positions, onProgress: input.onProgress });
}

async function generateDiscordCarouselPositions(input: {
  carouselId: string;
  positions: number[];
  onProgress?: (progress: DiscordGenerationProgress) => Promise<void> | void;
}): Promise<DiscordGenerationResult> {
  const failedPositions: number[] = [];
  let completed = 0;
  for (const position of input.positions) {
    try {
      await generateCarouselSlide({
        carouselId: input.carouselId,
        position,
        instruction: "Discord /generate request. Follow the persisted plan and shared visual direction.",
      });
    } catch {
      failedPositions.push(position);
    }
    completed += 1;
    const carousel = getCarouselSet(input.carouselId);
    if (!carousel) throw new Error("Carousel disappeared during generation.");
    try {
      await input.onProgress?.({ carousel, completed, total: input.positions.length, position });
    } catch (error) {
      console.error("Discord progress update failed:", error instanceof Error ? error.message : error);
    }
  }
  const carousel = getCarouselSet(input.carouselId);
  if (!carousel) throw new Error("Carousel disappeared after generation.");
  return { carousel, failedPositions };
}

export function keepSuccessfulDiscordSlides(carouselId: string) {
  let carousel = getCarouselSet(carouselId);
  if (!carousel) throw new Error("Carousel not found.");
  const successful = carousel.slides.filter((slide) => slide.imageUrl && (slide.status === "generated" || slide.status === "kept"));
  if (!successful.length) throw new Error("This carousel has no successful slides to keep.");
  for (const slide of successful) {
    const file = getCarouselSlideFile(carouselId, slide.position);
    carousel = updateCarouselSlide({ carouselId, position: slide.position, status: "kept", fileName: file?.file_name ?? null })!;
  }
  return carousel;
}

export function discordCarouselImageFiles(carousel: CarouselSet) {
  return carousel.slides.flatMap((slide) => {
    const file = getCarouselSlideFile(carousel.id, slide.position);
    if (!file?.file_name) return [];
    return [{
      position: slide.position,
      path: path.join(process.cwd(), "data", "carousels", carousel.id, file.file_name),
      name: `${carousel.id}-slide-${slide.position}.png`,
    }];
  });
}

export function discordCarouselCost(carousel: CarouselSet) {
  return carousel.slides.reduce((total, slide) => total + (slide.costUsd ?? 0), 0);
}
