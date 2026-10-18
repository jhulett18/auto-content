import type { CarouselPlan } from "./reference-types.ts";

export const DISCORD_GENERATION_SLIDE_COUNT = 3;
export const DISCORD_GENERATION_TOPIC_LIMIT = 500;

function cleanTopic(topic: string) {
  return topic.replace(/\s+/g, " ").trim();
}

export function validateDiscordGenerationTopic(topic: string) {
  const cleaned = cleanTopic(topic);
  if (!cleaned) throw new Error("Topic is required.");
  if (cleaned.length > DISCORD_GENERATION_TOPIC_LIMIT) {
    throw new Error(`Topic must be ${DISCORD_GENERATION_TOPIC_LIMIT} characters or fewer.`);
  }
  return cleaned;
}

export function buildDiscordCarouselPlan(topic: string): CarouselPlan {
  const cleaned = validateDiscordGenerationTopic(topic);
  const support = ["User-supplied topic; no external factual claims added."];
  return {
    sourceContextKey: "discord-user-topic",
    slides: [
      {
        position: 1,
        purpose: "Introduce the user-supplied topic without adding unsupported claims.",
        headline: "QUICK GUIDE",
        lines: [cleaned],
        productKinds: [],
        factualSupport: support,
        visualDirection: "Bold educational opener with strong negative space and one clear focal point.",
      },
      {
        position: 2,
        purpose: "Give the audience a safe verification framework.",
        headline: "CHECK THE SIGNALS",
        lines: ["FIND THE ORIGINAL SOURCE", "COMPARE TIME, PRICE, AND LIMITS", "SEPARATE FACTS FROM RUMORS"],
        productKinds: [],
        factualSupport: support,
        visualDirection: "Structured three-step editorial layout using the same palette and visual motifs.",
      },
      {
        position: 3,
        purpose: "Close with a practical verification reminder.",
        headline: "BEFORE YOU ACT",
        lines: ["VERIFY THE LATEST DETAILS", "SAVE THE SOURCE", "RECHECK BEFORE YOU BUY"],
        productKinds: [],
        factualSupport: support,
        visualDirection: "Calm checklist close that resolves the visual rhythm from the first two slides.",
      },
    ],
  };
}
