import { generateCarouselSlide } from "../../../../../../lib/openai-generation";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; position: string }> }) {
  const { id, position } = await params;
  const numericPosition = Number(position);
  if (!Number.isInteger(numericPosition) || numericPosition < 1) return Response.json({ error: "Invalid slide position." }, { status: 400 });
  try {
    const payload = await request.json().catch(() => ({})) as { instruction?: unknown };
    const carousel = await generateCarouselSlide({ carouselId: id, position: numericPosition, instruction: typeof payload.instruction === "string" ? payload.instruction : null });
    return Response.json(carousel);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Slide generation failed." }, { status: 502 });
  }
}
