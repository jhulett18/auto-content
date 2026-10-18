import { getCarouselSet } from "./references-db";
import { readGeneratedImage } from "./zernio";

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as {content?:unknown}).content) ? (item as {content:unknown[]}).content : [];
    return content.flatMap((part) => part && typeof part === "object" && (part as {type?:unknown}).type === "output_text" && typeof (part as {text?:unknown}).text === "string" ? [(part as {text:string}).text] : []);
  }).join("\n");
}

export async function reviewAutomatedCarousel(carouselId: string) {
  const carousel = getCarouselSet(carouselId);
  if (!carousel?.plan) throw new Error("A persisted carousel plan is required for automated review.");
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const notes: string[] = [];
  let passed = true;

  for (const slide of carousel.slides) {
    const review = await reviewAutomatedCarouselSlide(carouselId, slide.position);
    notes.push(`Slide ${slide.position}: ${review.summary}${review.issues.length ? ` — ${review.issues.join("; ")}` : ""}`);
    if (!review.passed) passed = false;
  }
  return { passed, notes };
}

export async function reviewAutomatedCarouselSlide(carouselId: string, position: number) {
  const carousel = getCarouselSet(carouselId);
  if (!carousel?.plan) throw new Error("A persisted carousel plan is required for automated review.");
  const slide = carousel.slides.find((candidate) => candidate.position === position);
  if (!slide?.imageUrl) throw new Error(`Slide ${position} has no generated image.`);
  const expected = carousel.plan.slides.find((item) => item.position === position);
  if (!expected) throw new Error(`Slide ${position} has no plan.`);
  const image = await readGeneratedImage(slide.imageUrl);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.6-luna",
        input: [{ role: "user", content: [
          { type: "input_text", text: `Review this generated social carousel slide. Expected deterministic copy:\nHeadline: ${expected.headline}\nLines: ${expected.lines.join(" | ")}\nAllowed brand text: ${carousel.targetBrand}. Fail if expected copy is missing or materially wrong; if any other legible words, logos, branded packaging, characters, fake app UI, unsafe content, or obvious source-brand imitation appears; or if the composition is materially unreadable.` },
          { type: "input_image", image_url: `data:${image.contentType};base64,${image.bytes.toString("base64")}`, detail: "high" },
        ] }],
        text: { format: { type: "json_schema", name: "carousel_review", strict: true, schema: {
          type: "object", additionalProperties: false,
          properties: { passed: { type: "boolean" }, issues: { type: "array", items: { type: "string" } }, summary: { type: "string" } },
          required: ["passed", "issues", "summary"],
        } } }, max_output_tokens: 900,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json() as Record<string, unknown> & {error?:{message?:string}};
    if (!response.ok) throw new Error(payload.error?.message || `Automated review failed with HTTP ${response.status}.`);
  return JSON.parse(outputText(payload)) as {passed:boolean;issues:string[];summary:string};
}
