import {
  listReferenceLibrary,
  setSelectedReferences,
  updateSavedReference,
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

export async function PATCH(request: Request) {
  try {
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object") throw new Error("Provide a reference update.");
    const input = payload as { id?: unknown; saved?: unknown; savedName?: unknown };
    if (typeof input.id !== "string" || typeof input.saved !== "boolean") throw new Error("Reference ID and saved state are required.");
    if (input.savedName !== undefined && input.savedName !== null && typeof input.savedName !== "string") throw new Error("Saved reference name must be text.");
    return Response.json(updateSavedReference(input.id, input.saved, input.savedName as string | null | undefined));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The saved reference could not be updated." }, { status: 400 });
  }
}
