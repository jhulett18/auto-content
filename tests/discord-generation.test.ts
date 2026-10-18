import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscordCarouselPlan,
  DISCORD_GENERATION_TOPIC_LIMIT,
  validateDiscordGenerationTopic,
} from "../lib/discord-generation-plan.ts";

test("Discord generation creates a safe deterministic three-slide plan", () => {
  const topic = "How to verify a Pokémon restock rumor";
  const plan = buildDiscordCarouselPlan(topic);

  assert.equal(plan.slides.length, 3);
  assert.deepEqual(plan.slides.map((slide) => slide.position), [1, 2, 3]);
  assert.equal(plan.slides[0].lines[0], topic);
  assert.equal(plan.slides[0].headline, "QUICK GUIDE");
  assert.ok(plan.slides.every((slide) => slide.productKinds.length === 0));
  assert.ok(plan.slides.every((slide) => slide.factualSupport.includes("User-supplied topic; no external factual claims added.")));
});

test("Discord generation normalizes and validates topic input", () => {
  assert.equal(validateDiscordGenerationTopic("  verify   the source  "), "verify the source");
  assert.throws(() => validateDiscordGenerationTopic("   "), /Topic is required/);
  assert.throws(() => validateDiscordGenerationTopic("x".repeat(DISCORD_GENERATION_TOPIC_LIMIT + 1)), /500 characters or fewer/);
});
