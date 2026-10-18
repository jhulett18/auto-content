export function discordApproverIds(environment:Record<string,string|undefined>=process.env) {
  const values=[
    ...(environment.DISCORD_APPROVER_USER_IDS||"").split(","),
    environment.DISCORD_APPROVER_USER_ID||"",
  ].map((value)=>value.trim()).filter((value)=>/^\d+$/.test(value));
  return [...new Set(values)];
}
