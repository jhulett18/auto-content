import { getGenerationBudget, setGenerationBudget } from "../../../lib/references-db";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(getGenerationBudget(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { balanceUsd?: unknown };
    if (typeof payload.balanceUsd !== "number") return Response.json({ error: "Enter a numeric current balance." }, { status: 400 });
    return Response.json(setGenerationBudget(payload.balanceUsd), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The image budget could not be saved." }, { status: 400 });
  }
}
