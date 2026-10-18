import assert from "node:assert/strict";
import test from "node:test";
import { candidateSignals, consolidateDailyStories, nextDefaultPublishTime, parsePublishDirective, publishTimeOnDate, qualifiesForDailyCarousel, rankDailyCandidates } from "../lib/daily-keywords.ts";
import type { DraftContextGroup } from "../lib/reference-types.ts";

function group(text: string, timestamp = "2026-10-06T20:00:00.000Z"): DraftContextGroup {
  return {key:text.slice(0,8),author:"GFNF",timestamp,text,attachments:[],products:[]};
}

test("requires an event plus urgency or two details", () => {
  assert.equal(qualifiesForDailyCarousel(candidateSignals(group("Target stock tonight"), new Date("2026-10-06T21:00:00Z"))), true);
  assert.equal(qualifiesForDailyCarousel(candidateSignals(group("Target stock SKU 123 Price $20"), new Date("2026-10-06T21:00:00Z"))), true);
  assert.equal(qualifiesForDailyCarousel(candidateSignals(group("Target ETB available"), new Date("2026-10-06T21:00:00Z"))), false);
});

test("ranking prefers richer timely messages", () => {
  const ranked = rankDailyCandidates([
    group("A raffle tonight"),
    group("Walmart raffle is live SKU: 123 Limit 2 Retail $30"),
  ], new Date("2026-10-06T21:00:00Z"));
  assert.match(ranked[0].group.text, /Walmart/);
});

test("parses explicit publish directives in the configured timezone", () => {
  assert.equal(parsePublishDirective("publish: 2026-11-02 10:30 am", "America/New_York"), "2026-11-02T15:30:00.000Z");
});

test("defaults to ten local time on the following day", () => {
  assert.equal(nextDefaultPublishTime(new Date("2026-10-06T22:00:00.000Z"), "America/New_York", "10:00"), "2026-10-07T14:00:00.000Z");
});

test("correction language removes stale live urgency", () => {
  const signals = candidateSignals(group("Draws should be live. Actually, it's tomorrow."), new Date("2026-10-07T01:00:00Z"));
  assert.equal(signals.urgency.includes("live"), false);
  assert.equal(signals.corrections.includes("timing moved to tomorrow"), true);
});

test("consolidates same-day retailer updates into one story", () => {
  const first = group("Walmart raffle tonight SKU 123", "2026-10-06T18:00:00.000Z");
  const second = group("Walmart raffle is live Limit 2", "2026-10-06T20:00:00.000Z");
  const stories = consolidateDailyStories([first, second]);
  assert.equal(stories.length, 1);
  assert.match(stories[0].text, /Limit 2/);
});

test("supports a same-day publication slot for overnight generation", () => {
  assert.equal(publishTimeOnDate("2026-10-07", "America/New_York", "10:00"), "2026-10-07T14:00:00.000Z");
});
