import { createHash } from "node:crypto";
import type { DraftAttachment, DraftContextGroup, ProductRequirement } from "./reference-types";

type ExportMessage = { message: string; name: string; timestamp: string };

const ATTACHMENT_PATTERN = /Attachment:\s*([^—\n]+?)\s*—\s*(https:\/\/\S+)/g;

function isExportMessage(value: unknown): value is ExportMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.message === "string" && typeof record.name === "string" && typeof record.timestamp === "string" && Number.isFinite(Date.parse(record.timestamp));
}

function contextKey(message: ExportMessage) {
  return createHash("sha256").update(`${message.timestamp}\n${message.name}\n${message.message}`).digest("hex").slice(0, 24);
}

export function attachmentsFromMessage(message: string): DraftAttachment[] {
  return [...message.matchAll(ATTACHMENT_PATTERN)].map((match) => ({ name: match[1].trim(), url: match[2] }));
}

export function sanitizeContextText(message: string) {
  return message
    .replace(ATTACHMENT_PATTERN, " ")
    .replace(/<[@#&][^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`]+/g, "")
    .replace(/<a?:[^:>]+:\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractProductRequirements(text: string): ProductRequirement[] {
  const normalized = text.replace(/[*_`]+/g, " ").replace(/\s+/g, " ");
  const pattern = /\b(ETB|Bundle|Booster Box)\b[\s\S]{0,90}?\bSKU\s*:?\s*([\d-]+)[\s\S]{0,60}?\bLimit\s*(\d+)/gi;
  const kinds: Record<string, ProductRequirement["kind"]> = { etb: "etb", bundle: "bundle", "booster box": "booster_box" };
  const labels: Record<ProductRequirement["kind"], string> = { etb: "ETB", bundle: "Bundle", booster_box: "Booster Box" };
  return [...normalized.matchAll(pattern)].map((match) => {
    const kind = kinds[match[1].toLowerCase()];
    return { kind, label: labels[kind], sku: match[2], limit: Number(match[3]) };
  });
}

export function groupRecentMessages(messages: ExportMessage[], limit: number | null = 50): DraftContextGroup[] {
  const sorted = [...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const recent = limit === null ? sorted : sorted.slice(-limit);
  const groups: DraftContextGroup[] = [];
  for (const message of recent) {
    const attachments = attachmentsFromMessage(message.message);
    const text = sanitizeContextText(message.message);
    const previous = groups.at(-1);
    const isAttachmentOnly = attachments.length > 0 && !text;
    const closeToPrevious = previous && previous.author === message.name && Date.parse(message.timestamp) - Date.parse(previous.timestamp) <= 120_000;
    if (isAttachmentOnly && closeToPrevious) {
      previous.attachments.push(...attachments);
      continue;
    }
    const isLikelyFollowUp = closeToPrevious && text.length > 0 && text.length <= 240;
    if (isLikelyFollowUp && previous) {
      previous.text = `${previous.text}\n${text}`.trim();
      previous.attachments.push(...attachments);
      previous.products = extractProductRequirements(previous.text);
      continue;
    }
    if (!text && attachments.length === 0) continue;
    groups.push({
      key: contextKey(message),
      author: message.name,
      timestamp: message.timestamp,
      text,
      attachments,
      products: extractProductRequirements(text),
    });
  }
  return groups.reverse();
}

async function fetchGfnfMessages() {
  const token = process.env.ALETHEIA_API_TOKEN?.trim();
  const exportUrl = process.env.ALETHEIA_EXPORT_URL?.trim();
  if (!token || !exportUrl) throw new Error("GFNF export is not configured.");
  const response = await fetch(exportUrl, {
    headers: { Accept: "application/x-ndjson, application/jsonl, text/plain", Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GFNF responded with HTTP ${response.status}.`);
  const lines = (await response.text()).split(/\r?\n/).filter((line) => line.trim());
  const messages = lines.flatMap((line) => {
    try { const value: unknown = JSON.parse(line); return isExportMessage(value) ? [value] : []; }
    catch { return []; }
  });
  return { messages, sourceRecordCount: messages.length, lineCount: lines.length };
}

export async function fetchRecentGfnfContext(limit = 50) {
  const exported = await fetchGfnfMessages();
  return { ...exported, groups: groupRecentMessages(exported.messages, limit) };
}

export function localDateKey(value: Date | string, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export async function fetchGfnfContextForDate(targetDate: string, timeZone = "America/New_York") {
  const exported = await fetchGfnfMessages();
  const groups = groupRecentMessages(exported.messages, null).filter((group) => localDateKey(group.timestamp, timeZone) === targetDate);
  return { ...exported, groups, targetDate };
}
