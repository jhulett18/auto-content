import type { ImageGenerationUsage } from "./reference-types";

type OpenAIImageUsage = {
  input_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens?: number;
};

export function normalizeImageUsage(usage: OpenAIImageUsage | undefined): ImageGenerationUsage | null {
  if (!usage) return null;
  const inputTokens = Math.max(0, usage.input_tokens ?? 0);
  const imageInputTokens = Math.max(0, usage.input_tokens_details?.image_tokens ?? 0);
  const textInputTokens = Math.max(0, usage.input_tokens_details?.text_tokens ?? Math.max(0, inputTokens - imageInputTokens));
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);
  return { inputTokens, textInputTokens, imageInputTokens, outputTokens };
}

export function imageGenerationCostUsd(model: string, usage: ImageGenerationUsage | null) {
  if (!usage || !model.startsWith("gpt-image-2.5")) return null;
  return (
    usage.textInputTokens * 5
    + usage.imageInputTokens * 8
    + usage.outputTokens * 30
  ) / 1_000_000;
}
