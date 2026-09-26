import {
  listReferenceLibrary,
  setSelectedReferences,
} from "../../../lib/references-db";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(listReferenceLibrary());
}

export async function PUT(request: Request) {
  try {
    const payload: unknown = await request.json();
    const ids =
      payload &&
      typeof payload === "object" &&
      Array.isArray((payload as { ids?: unknown }).ids)
        ? (payload as { ids: unknown[] }).ids
        : null;

    if (!ids || !ids.every((id): id is string => typeof id === "string")) {
      return Response.json(
        { error: "Provide a list of reference IDs." },
        { status: 400 },
      );
    }

    return Response.json(setSelectedReferences(ids));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The reference selection could not be saved.",
      },
      { status: 400 },
    );
  }
}
