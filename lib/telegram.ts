import { getCarouselSet } from "./references-db";
import { readReferenceImage } from "./reference-media-cache";
import { readGeneratedImage } from "./zernio";
import type { DailyWorkflowRun } from "./reference-types";

type TelegramUpdate = {
  update_id: number;
  message?: { message_id:number; text?:string; chat:{id:number|string} };
  callback_query?: { id:string; data?:string; message?:{message_id:number;chat:{id:number|string}} };
};

function configuration() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) throw new Error("Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
  return { token, chatId };
}

async function telegramRequest<T>(method: string, body: Record<string, unknown> | FormData) {
  const { token } = configuration();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json() as {ok:boolean;result?:T;description?:string};
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram ${method} failed with HTTP ${response.status}.`);
  return payload.result as T;
}

export async function getTelegramUpdates(offset: number) {
  const result = await telegramRequest<TelegramUpdate[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message", "callback_query"] });
  const { chatId } = configuration();
  return result.filter((update) => String(update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? "") === chatId);
}

export async function answerTelegramCallback(id: string, text: string) {
  await telegramRequest("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 180) });
}

export async function sendTelegramMessage(text: string, replyMarkup?: Record<string, unknown>) {
  const { chatId } = configuration();
  return telegramRequest<{message_id:number}>("sendMessage", { chat_id: chatId, text: text.slice(0, 4_000), parse_mode: "HTML", ...(replyMarkup ? {reply_markup:replyMarkup} : {}) });
}

async function sendCarouselMedia(carouselId: string, label: "A" | "B") {
  const carousel = getCarouselSet(carouselId);
  if (!carousel || carousel.slides.some((slide) => !slide.imageUrl)) throw new Error(`Variation ${label} is missing generated slides.`);
  const form = new FormData();
  const { chatId } = configuration();
  form.set("chat_id", chatId);
  const media = [];
  for (const [index, slide] of carousel.slides.entries()) {
    const image = await readGeneratedImage(slide.imageUrl!);
    const key = `${label.toLowerCase()}${index}`;
    form.set(key, new Blob([new Uint8Array(image.bytes)], { type: image.contentType }), image.fileName);
    media.push({ type: "photo", media: `attach://${key}`, ...(index === 0 ? {caption:`Variation ${label} · ${carousel.name}`} : {}) });
  }
  form.set("media", JSON.stringify(media));
  await telegramRequest("sendMediaGroup", form);
}

export async function sendAutomationApproval(run: DailyWorkflowRun) {
  if (!run.referenceId || !run.referenceName) throw new Error("The automation run has no saved reference.");
  const reference = await readReferenceImage(run.referenceId, "thumbnail");
  const referenceForm = new FormData();
  const { chatId } = configuration();
  referenceForm.set("chat_id", chatId);
  referenceForm.set("photo", new Blob([new Uint8Array(reference)], { type: "image/webp" }), "reference.webp");
  referenceForm.set("caption", `Saved reference: ${run.referenceName}`);
  await telegramRequest("sendPhoto", referenceForm);
  for (const label of ["A", "B"] as const) {
    const variation = run.variations.find((candidate) => candidate.label === label);
    if (!variation || variation.reviewStatus !== "passed") throw new Error(`Variation ${label} did not pass automated review.`);
    await sendCarouselMedia(variation.carouselId, label);
  }
  const schedule = run.scheduledFor ? new Intl.DateTimeFormat("en-US", { dateStyle:"medium", timeStyle:"short", timeZone:process.env.AUTOMATION_TIMEZONE?.trim() || "America/New_York" }).format(new Date(run.scheduledFor)) : "not set";
  const message = await sendTelegramMessage(
    `<b>Daily carousel approval</b>\n\nSource: ${escapeHtml(run.candidateText?.slice(0, 700) || "Unavailable")}\n\nReference: ${escapeHtml(run.referenceName)}\nScheduled: ${escapeHtml(schedule)}\n\nUse /refs to list saved references or /ref &lt;name&gt; to regenerate both variations.`,
    { inline_keyboard: [[{text:"Approve A",callback_data:`a:${run.id}:A`},{text:"Approve B",callback_data:`a:${run.id}:B`}],[{text:"Change reference",callback_data:`r:${run.id}`},{text:"Reject both",callback_data:`x:${run.id}`}]] },
  );
  return message.message_id;
}

export function escapeHtml(value: string) {
  return value.replace(/[<>&]/g, (character) => ({"<":"&lt;",">":"&gt;","&":"&amp;"})[character]!);
}
