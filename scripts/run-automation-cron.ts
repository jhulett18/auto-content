import { loadEnvConfig } from "@next/env";
import { runDailyAutomation } from "../lib/daily-automation";

loadEnvConfig(process.cwd());

const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || "approval";
if (!["intake", "nightly", "generate", "approval", "report"].includes(mode)) {
  throw new Error("Use --mode=intake, --mode=generate, --mode=approval, or --mode=report.");
}

async function main() {
  const result = await runDailyAutomation({ mode: mode as "intake" | "nightly" | "generate" | "approval" | "report" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
