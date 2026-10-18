import { createHash } from "node:crypto";
import type { DailyCandidateSignals, DraftContextGroup } from "./reference-types";

const SIGNALS = {
  events: ["drop", "stock", "raffle", "draw", "release", "restock", "preorder", "loaded"],
  urgency: ["live", "tonight", "tomorrow", "reminder", "ends", "closes", "release day"],
  details: ["sku", "pid", "available stock", "limit", "max", "qty", "quantity", "retail", "price", "msrp", "link"],
} as const;

function contains(text: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const suffix = keyword === "drop" ? "(?:s|ped|ping)?" : keyword === "draw" ? "(?:s|ing)?" : keyword === "raffle" || keyword === "restock" || keyword === "preorder" ? "s?" : "";
  return new RegExp(`\\b${escaped}${suffix}\\b`, "i").test(text);
}

export function candidateSignals(group: DraftContextGroup, now = new Date()): DailyCandidateSignals {
  const text = group.text;
  const events = SIGNALS.events.filter((keyword) => contains(text, keyword));
  let urgency = SIGNALS.urgency.filter((keyword) => contains(text, keyword));
  const details: string[] = SIGNALS.details.filter((keyword) => contains(text, keyword));
  const corrections = [
    /\bit'?s tomorrow\b/i.test(text) ? "timing moved to tomorrow" : null,
    /\b(?:not|isn'?t|wasn'?t) live\b/i.test(text) ? "not live" : null,
    /\b(?:didn'?t|did not) drop\b/i.test(text) ? "drop did not happen" : null,
    /\b(?:wrong|incorrect)\s+(?:date|day|time|list|sku)\b/i.test(text) ? "source correction" : null,
  ].filter((value): value is string => Boolean(value));
  if (corrections.some((correction) => correction === "timing moved to tomorrow" || correction === "not live")) {
    urgency = urgency.filter((keyword) => keyword !== "live");
  }
  if (/https?:\/\//i.test(text) || group.attachments.length > 0) details.push("link");
  if (/\$\s?\d|\b\d+(?:\.\d+)?k\+?\b/i.test(text)) details.push("numeric detail");

  const uniqueDetails = [...new Set(details)];
  const ageHours = Math.max(0, (now.getTime() - Date.parse(group.timestamp)) / 3_600_000);
  const freshness = Math.max(0, 24 - Math.min(24, ageHours));
  const score = events.length * 20 + urgency.length * 10 + uniqueDetails.length * 5
    + Math.min(group.products.length, 5) * 8 + Math.min(group.attachments.length, 3) * 6 + freshness / 4 - corrections.length * 5;
  const explanation = [
    events.length ? `Event: ${events.join(", ")}` : null,
    urgency.length ? `Urgency: ${urgency.join(", ")}` : null,
    uniqueDetails.length ? `Details: ${uniqueDetails.join(", ")}` : null,
    group.products.length ? `${group.products.length} structured product${group.products.length === 1 ? "" : "s"}` : null,
    group.attachments.length ? `${group.attachments.length} attachment${group.attachments.length === 1 ? "" : "s"}` : null,
    corrections.length ? `Corrections applied: ${corrections.join(", ")}` : null,
  ].filter((value): value is string => Boolean(value));
  return { events, urgency, details: uniqueDetails, corrections, score: Math.round(score * 10) / 10, explanation };
}

export function qualifiesForDailyCarousel(signals: DailyCandidateSignals) {
  return signals.events.length >= 1 && (signals.urgency.length >= 1 || signals.details.length >= 2);
}

export function rankDailyCandidates(groups: DraftContextGroup[], now = new Date()) {
  return groups
    .map((group) => ({ group, signals: candidateSignals(group, now) }))
    .filter(({ signals }) => qualifiesForDailyCarousel(signals))
    .sort((left, right) => right.signals.score - left.signals.score || Date.parse(right.group.timestamp) - Date.parse(left.group.timestamp));
}

export function localDateKey(value: Date | string, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function previousLocalDate(now = new Date(), timeZone = "America/New_York") {
  const today = localDateKey(now, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function consolidateDailyStories(groups: DraftContextGroup[]) {
  const stories = new Map<string, DraftContextGroup>();
  for (const group of [...groups].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))) {
    const retailer = group.text.match(/\b(Target|Walmart|Menards|PKC|EQL|RunFair)\b/i)?.[0]?.toLowerCase() ?? "general";
    const event = SIGNALS.events.find((keyword) => contains(group.text, keyword)) ?? "update";
    const topic = `${retailer}:${event}`;
    const existing = stories.get(topic);
    if (!existing) {
      stories.set(topic, { ...group, key: `story-${createHash("sha256").update(`${topic}\n${group.timestamp.slice(0, 10)}`).digest("hex").slice(0, 18)}`, attachments: [...group.attachments], products: [...group.products] });
      continue;
    }
    existing.text = `${existing.text}\n${group.text}`.trim();
    existing.timestamp = group.timestamp;
    existing.attachments = [...new Map([...existing.attachments, ...group.attachments].map((attachment) => [attachment.url, attachment])).values()];
    existing.products = [...new Map([...existing.products, ...group.products].map((product) => [`${product.kind}:${product.sku}`, product])).values()];
  }
  return [...stories.values()];
}

export function messageFingerprint(input: { timestamp: string; author: string; text: string }) {
  return createHash("sha256").update(`${input.timestamp}\n${input.author}\n${input.text}`).digest("hex");
}

export function parsePublishDirective(text: string, timeZone = "America/New_York") {
  const match = text.match(/\bpublish\s*:\s*(\d{4}-\d{2}-\d{2})(?:[ T]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (!match) return null;
  let hour = match[2] ? Number(match[2]) : 10;
  const minute = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return zonedDateTimeToUtc(match[1], hour, minute, timeZone);
}

export function nextDefaultPublishTime(now = new Date(), timeZone = "America/New_York", clock = "10:00") {
  const local = localDateKey(now, timeZone);
  const [year, month, day] = local.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return publishTimeOnDate(tomorrow.toISOString().slice(0, 10), timeZone, clock);
}

export function publishTimeOnDate(date: string, timeZone = "America/New_York", clock = "10:00") {
  const [hour, minute] = clock.split(":").map(Number);
  return zonedDateTimeToUtc(date, hour, minute, timeZone);
}

function zonedDateTimeToUtc(date: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(guess);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute));
  guess = new Date(guess.getTime() + (Date.UTC(year, month - 1, day, hour, minute) - represented));
  return guess.toISOString();
}
