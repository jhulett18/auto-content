import assert from "node:assert/strict";
import test from "node:test";
import { discordApproverIds } from "../lib/discord-approvers.ts";

test("builds a unique Discord approver allowlist with legacy fallback",()=> {
  assert.deepEqual(discordApproverIds({DISCORD_APPROVER_USER_IDS:"111, 222,111",DISCORD_APPROVER_USER_ID:"333"}),["111","222","333"]);
  assert.deepEqual(discordApproverIds({DISCORD_APPROVER_USER_ID:"444"}),["444"]);
});
