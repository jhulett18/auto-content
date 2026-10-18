import { listAutomationRuns } from "../../../../lib/automation-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({runs:listAutomationRuns()});
}
