import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const secret = process.env.AUTOMATION_CRON_SECRET?.trim();
if (!secret) throw new Error("AUTOMATION_CRON_SECRET is not configured.");
const baseUrl = process.env.AUTOMATION_APP_URL?.trim() || "http://localhost:3000";
const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || "approval";
if (!["intake","nightly","generate","approval","report"].includes(mode)) throw new Error("Use --mode=intake, --mode=generate, --mode=approval, or --mode=report.");
const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/automation/cron`, {
  method:"POST", headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"}, body:JSON.stringify({mode}), signal:AbortSignal.timeout(15 * 60_000),
});
const body = await response.text();
if (!response.ok) throw new Error(`Automation cron failed (${response.status}): ${body}`);
process.stdout.write(`${body}\n`);
