export const DISCORD_REFERENCE_PAGE_SIZE = 5;
export const DISCORD_TOPIC_LIMIT = 5;
export const DISCORD_SOURCE_LOOKBACK_DAYS = 7;

function dateKey(value: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function shouldEvergreenReframe(timestamp:string, now=new Date(), timeZone="America/New_York") {
  return dateKey(timestamp,timeZone) !== dateKey(now,timeZone);
}

export function evergreenDiscordTopicLabel(text:string) {
  const normalized=text.toLowerCase();
  if (/raffle|draw/.test(normalized)) return "How to prepare for a retailer draw";
  if (/preorder|release/.test(normalized)) return "How to verify release information";
  if (/restock|stock|drop|loaded/.test(normalized)) return "How to prepare for a retail restock";
  return "How to verify a collector alert";
}

function normalizedTopicLabel(label:string) {
  return label.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
}

export function deduplicateDiscordTopics<T extends {label:string}>(topics:T[]) {
  const seen=new Set<string>();
  return topics.filter((topic)=> {
    const key=normalizedTopicLabel(topic.label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function discordReferenceTitle(reference:{savedName?:string|null;caption?:string|null;creatorHandle:string;platform:string}) {
  const title=reference.savedName?.trim()||reference.caption?.replace(/\s+/g," ").trim()||`@${reference.creatorHandle} · ${reference.platform}`;
  return title.slice(0,100);
}

export function discordReferencePostUrl(reference:{postUrl?:string|null}) {
  if (!reference.postUrl) return null;
  try {
    const url=new URL(reference.postUrl);
    return url.protocol==="https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function paginateDiscordReferences<T>(references:T[], page:number, pageSize=DISCORD_REFERENCE_PAGE_SIZE) {
  const pages=Math.max(1,Math.ceil(references.length/pageSize));
  const safePage=Math.min(Math.max(Math.trunc(page)||0,0),pages-1);
  return { page:safePage, pages, items:references.slice(safePage*pageSize,(safePage+1)*pageSize) };
}
