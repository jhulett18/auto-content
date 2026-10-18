import { timingSafeEqual } from "node:crypto";
import { runDailyAutomation } from "../../../../lib/daily-automation";

export const runtime = "nodejs";
export const maxDuration = 800;

function authorized(request: Request) {
  const configured = process.env.AUTOMATION_CRON_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const configuredBytes = Buffer.from(configured || "");
  const providedBytes = Buffer.from(provided);
  if (!configured || configuredBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(configuredBytes, providedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({error:"Unauthorized."},{status:401});
  try {
    const payload = await request.json().catch(() => ({})) as {mode?:unknown};
    if (!["intake","nightly","generate","approval","report"].includes(String(payload.mode))) return Response.json({error:"mode must be intake, nightly, generate, approval, or report."},{status:400});
    return Response.json(await runDailyAutomation({mode:payload.mode as "intake"|"nightly"|"generate"|"approval"|"report"}));
  } catch (error) {
    return Response.json({error:error instanceof Error ? error.message : "The daily automation run failed."},{status:500});
  }
}
