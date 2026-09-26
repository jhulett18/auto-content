import { analyzeReference } from "../../../../../lib/openai-reference-analysis";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(
  request: Request,
  context: RouteContext<"/api/references/[id]/analyze">,
) {
  const { id } = await context.params;
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";

  try {
    return Response.json(await analyzeReference(id, { refresh }));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The reference could not be analyzed.",
      },
      { status: 502 },
    );
  }
}
