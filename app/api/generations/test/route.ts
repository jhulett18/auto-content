import { generateTestingImage } from "../../../../lib/openai-generation";
import { TOPIC_STYLES } from "../../../../app/topic-styles";

export const runtime = "nodejs";
export const maxDuration = 240;

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      referenceId?: unknown;
      topicStyleId?: unknown;
    };
    if (typeof payload.referenceId !== "string" || typeof payload.topicStyleId !== "string") {
      return Response.json({ error: "Provide a referenceId and topicStyleId." }, { status: 400 });
    }

    const style = TOPIC_STYLES.find((candidate) => candidate.id === payload.topicStyleId);
    if (!style) return Response.json({ error: "The selected topic style is invalid." }, { status: 400 });

    return Response.json(
      await generateTestingImage({
        referenceId: payload.referenceId,
        topicStyleId: style.id,
        topicStyleName: style.name,
        topicStyleDescription: style.description,
      }),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The testing image could not be generated." },
      { status: 502 },
    );
  }
}
