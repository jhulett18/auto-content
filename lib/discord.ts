import { getCarouselSet } from "./references-db";
import { readGeneratedImage } from "./zernio";
import type { DailyWorkflowRun } from "./reference-types";
import type { DraftContextGroup } from "./reference-types";
import { discordApproverIds } from "./discord-approvers";

const TIME_ZONE = process.env.AUTOMATION_TIMEZONE?.trim() || "America/New_York";

function webhookUrl() {
  const value = process.env.DISCORD_OUTPUT_WEBHOOK_URL?.trim();
  if (!value) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("DISCORD_OUTPUT_WEBHOOK_URL must be a valid Discord webhook URL."); }
  if (parsed.protocol !== "https:" || (parsed.hostname !== "discord.com" && !parsed.hostname.endsWith(".discord.com"))) throw new Error("DISCORD_OUTPUT_WEBHOOK_URL must be an HTTPS Discord webhook URL.");
  return parsed.toString();
}

async function sendWebhook(content: string, files: Array<{ name: string; bytes: Uint8Array; contentType: string }> = []) {
  const url = webhookUrl();
  if (!url) return null;
  const form = new FormData();
  form.set("payload_json", JSON.stringify({ content: content.slice(0, 2_000), allowed_mentions: { parse: [] } }));
  for (const [index, file] of files.entries()) form.set(`files[${index}]`, new Blob([file.bytes as unknown as BlobPart], { type: file.contentType }), file.name);
  const response = await fetch(`${url}?wait=true`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status}).`);
  return response.json().catch(() => null) as Promise<{ id?: string } | null>;
}

function botConfiguration() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_APPROVAL_CHANNEL_ID?.trim();
  const approverIds = discordApproverIds();
  if (!token || !channelId || !approverIds.length) throw new Error("Discord approval is not configured.");
  return { token, channelId, approverIds };
}

async function discordApi<T>(pathname: string) {
  const { token } = botConfiguration();
  const response = await fetch(`https://discord.com/api/v10${pathname}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Discord API failed (${response.status}).`);
  return response.json() as Promise<T>;
}

function formatSchedule(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE }).format(new Date(value)) : "not set";
}

function signalsSummary(run: DailyWorkflowRun) {
  if (!run.signals) return "none";
  const values = [...run.signals.events, ...run.signals.urgency, ...run.signals.details];
  return values.length ? values.join(", ") : "none";
}

export async function sendDiscordApproval(run: DailyWorkflowRun) {
  if (!webhookUrl()) return null;
  const summary = await sendWebhook([
    `**GFNF Daily Automation — ${run.runDate}**`,
    `Status: awaiting Discord approval · Run: \`${run.id}\``,
    `Source: ${run.candidateText ? run.candidateText.replace(/\s+/g, " ").slice(0, 900) : "Unavailable"}`,
    `Timestamp: ${run.candidateTimestamp || "Unavailable"}`,
    `Signals: ${signalsSummary(run)}`,
    `Reference: ${run.referenceName || "Unavailable"}`,
    `Proposed Instagram publish: ${formatSchedule(run.scheduledFor)}`,
    "React to this message: 🅰️ approve A · 🅱️ approve B · 🔄 regenerate · ❌ reject both.",
  ].join("\n"));
  for (const label of ["A", "B"] as const) {
    const variation = run.variations.find((candidate) => candidate.label === label);
    if (!variation || variation.reviewStatus !== "passed") throw new Error(`Variation ${label} did not pass automated review.`);
    const carousel = getCarouselSet(variation.carouselId);
    if (!carousel || carousel.slides.some((slide) => !slide.imageUrl)) throw new Error(`Variation ${label} is missing generated slides.`);
    const files = await Promise.all(carousel.slides.map(async (slide, index) => {
      const image = await readGeneratedImage(slide.imageUrl!);
      return { name: `${run.id}-${label.toLowerCase()}-${index + 1}.png`, bytes: new Uint8Array(image.bytes), contentType: image.contentType };
    }));
    await sendWebhook(`**Variation ${label}** · ${carousel.name}\nThree-slide preview for run \`${run.id}\`.`, files);
  }
  return summary?.id || null;
}

type DiscordReaction = { emoji: { name?: string | null; id?: string | null } };
type DiscordUser = { id: string };
const decisions = new Map([["🅰️", "A"], ["🅱️", "B"], ["🔄", "regenerate"], ["❌", "reject"]] as const);

export async function getDiscordDecision(messageId: string | null) {
  if (!messageId) return null;
  const { channelId, approverIds } = botConfiguration();
  const message = await discordApi<{ reactions?: DiscordReaction[] }>(`/channels/${channelId}/messages/${messageId}`);
  for (const reaction of message.reactions || []) {
    const name = reaction.emoji.name || "";
    const decision = decisions.get(name as "🅰️" | "🅱️" | "🔄" | "❌");
    if (!decision) continue;
    const users = await discordApi<DiscordUser[]>(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(name)}?limit=100`);
    if (users.some((user) => approverIds.includes(user.id))) return decision;
  }
  return null;
}

export async function sendDiscordScheduled(run: DailyWorkflowRun) {
  if (!webhookUrl()) return false;
  await sendWebhook(["**Instagram carousel scheduled**", `Variation: ${run.approvedVariation || "unknown"}`, `Publish time: ${formatSchedule(run.scheduledFor)}`, `Zernio post ID: ${run.zernioPostId || "created"}`, `Run: \`${run.id}\``].join("\n"));
  return true;
}

export async function sendDiscordNoCandidate(runDate: string, scannedRecords?: number) {
  if (!webhookUrl()) return false;
  await sendWebhook(`**GFNF Daily Automation — ${runDate}**\nNo eligible story found.${scannedRecords === undefined ? "" : ` Scanned ${scannedRecords} source records.`}`);
  return true;
}

export async function sendDiscordIdeaAlert(group: DraftContextGroup, signals: { events: string[]; urgency: string[]; score: number }) {
  if (!webhookUrl()) return false;
  await sendWebhook(["**GFNF ALERT**", `Topic: ${signals.events.join(", ") || "market update"}`, `Why it matters: ${signals.urgency.join(", ") || "new actionable information"}`, `Source: ${group.timestamp} · ${group.author}`, `Details: ${group.text.slice(0, 900)}`, `Score: ${signals.score}`, "Action: added to today’s carousel queue."].join("\n"));
  return true;
}

export async function sendDiscordDailyReport(input: { date: string; scanned: number; ideas: number; urgent: number; run: DailyWorkflowRun | null }) {
  if (!webhookUrl()) return false;
  const run = input.run;
  await sendWebhook(["**LOCK-IN SUPPLY DAILY REPORT**", `Date: ${input.date}`, `Ideas found: ${input.ideas}`, `Urgent alerts: ${input.urgent}`, `Carousel: ${run ? `${run.status} · ${run.approvedVariation ? `Variation ${run.approvedVariation}` : "awaiting approval"}` : "not generated"}`, `Candidate: ${run?.candidateText?.replace(/\s+/g, " ").slice(0, 500) || "none"}`, `Publish: ${formatSchedule(run?.scheduledFor || null)}`, `Zernio: ${run?.zernioPostId || "not scheduled"}`, `Source records scanned: ${input.scanned}`].join("\n"));
  return true;
}
