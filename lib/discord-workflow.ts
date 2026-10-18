import { candidateSignals, consolidateDailyStories, localDateKey, qualifiesForDailyCarousel } from "./daily-keywords";
import { fetchRecentGfnfContext } from "./gfnf-context";
import { listRecentAutomationContexts, persistAutomationGroups } from "./automation-db";
import { createCarouselSet, getCarouselSet, getCarouselSlideFile, listSavedImageReferences, updateCarouselSlide } from "./references-db";
import { generateCarouselSlide } from "./openai-generation";
import { reviewAutomatedCarouselSlide } from "./automated-review";
import { getInstagramBestTimes, listScheduledInstagramPosts, scheduleInstagramCarousel } from "./zernio";
import { recordDiscordSlideAttempt, updateDiscordSession, type DiscordContentSession, type PlannedDiscordContent } from "./discord-workflow-db";
import type { CarouselPlan, DraftContextGroup } from "./reference-types";
import { DISCORD_SOURCE_LOOKBACK_DAYS, DISCORD_TOPIC_LIMIT, deduplicateDiscordTopics, evergreenDiscordTopicLabel, shouldEvergreenReframe } from "./discord-workflow-policy";

const TIME_ZONE = process.env.AUTOMATION_TIMEZONE?.trim() || "America/New_York";

export type DiscordTopicCandidate = { group:DraftContextGroup; label:string; summary:string; reason:string; evergreen:boolean };

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as {content?:unknown}).content)
    ? (item as {content:Array<{type?:string;text?:string}>}).content.flatMap((part) => part.type === "output_text" && part.text ? [part.text] : []) : []).join("\n");
}

function compact(value:string, max=180) {
  const clean=value.replace(/\s+/g," ").trim();
  return clean.length <= max ? clean : `${clean.slice(0,max-1).trim()}…`;
}

function addDays(date:Date, days:number) { const value=new Date(date); value.setUTCDate(value.getUTCDate()+days); return value; }

export async function syncDiscordGfnf(now=new Date()) {
  const exported=await fetchRecentGfnfContext(500);
  const cutoff=addDays(now,-DISCORD_SOURCE_LOOKBACK_DAYS).getTime();
  const recent=exported.groups.filter((group)=>Date.parse(group.timestamp)>=cutoff);
  const byDate=Map.groupBy(recent,(group)=>localDateKey(group.timestamp,TIME_ZONE));
  let imported=0;
  for (const groups of byDate.values()) imported += persistAutomationGroups(consolidateDailyStories(groups),(group)=>candidateSignals(group,now),qualifiesForDailyCarousel);
  return {sourceRecords:exported.sourceRecordCount,groups:recent.length,imported};
}

export function listDiscordTopicCandidates(now=new Date(), limit=DISCORD_TOPIC_LIMIT): DiscordTopicCandidate[] {
  const cutoff=addDays(now,-DISCORD_SOURCE_LOOKBACK_DAYS).toISOString();
  const ranked=listRecentAutomationContexts(cutoff)
    .filter((candidate)=>candidate.eligible)
    .map(({group,signals})=> {
      const evergreen=shouldEvergreenReframe(group.timestamp,now,TIME_ZONE);
      return {
        group,
        label:evergreen ? evergreenDiscordTopicLabel(group.text) : compact(group.text,90),
        summary:evergreen ? "Evergreen reframe; expired timing and availability claims will be removed." : compact(group.text),
        reason:(signals?.explanation ?? []).join(" · ") || "Saved GFNF source",
        evergreen,
        score:(signals?.score ?? 0) + (evergreen ? 0 : 100),
      };
    })
    .sort((a,b)=>b.score-a.score || Date.parse(b.group.timestamp)-Date.parse(a.group.timestamp));
  return deduplicateDiscordTopics(ranked)
    .slice(0,limit)
    .map((candidate)=>({group:candidate.group,label:candidate.label,summary:candidate.summary,reason:candidate.reason,evergreen:candidate.evergreen}));
}

function fallbackPlan(candidate:DiscordTopicCandidate, slideCount:number): PlannedDiscordContent {
  const support=[candidate.evergreen ? "Evergreen reframe; no time-sensitive source claim retained." : candidate.group.key];
  const slides:CarouselPlan["slides"]=[
    {position:1,purpose:"Introduce the audience promise.",headline:"COLLECTOR CHECKLIST",lines:[candidate.label.toUpperCase()],productKinds:[],factualSupport:support,visualDirection:"Bold educational opener with one clear focal point."},
    {position:2,purpose:"Give a practical verification sequence.",headline:"CHECK THE SOURCE",lines:["FIND THE ORIGINAL UPDATE","CHECK THE DATE AND TIME","SEPARATE FACT FROM RUMOR"],productKinds:[],factualSupport:support,visualDirection:"Structured checklist using the shared palette."},
    {position:3,purpose:"Turn verification into a decision.",headline:"BEFORE YOU ACT",lines:["CONFIRM PRICE AND LIMITS","RECHECK AVAILABILITY","STICK TO YOUR BUDGET"],productKinds:[],factualSupport:support,visualDirection:"Calm decision framework with strong hierarchy."},
  ];
  if (slideCount===4) slides.splice(2,0,{position:3,purpose:"Call out warning signs.",headline:"RED FLAGS",lines:["NO ORIGINAL SOURCE","OLD SCREENSHOTS","PRESSURE WITHOUT PROOF"],productKinds:[],factualSupport:support,visualDirection:"High-contrast warning panel without fake interface elements."});
  slides.forEach((slide,index)=>slide.position=index+1);
  return {plan:{sourceContextKey:candidate.group.key,slides},caption:`${candidate.label}. Save this checklist and verify the original source before acting.`,title:candidate.label,subject:candidate.label,topicStyleId:"educational"};
}

export async function planDiscordContent(candidate:DiscordTopicCandidate, slideCount:number):Promise<PlannedDiscordContent> {
  if (![3,4].includes(slideCount)) throw new Error("Choose three or four slides.");
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallbackPlan(candidate,slideCount);
  const schema={type:"object",additionalProperties:false,properties:{title:{type:"string"},subject:{type:"string"},caption:{type:"string"},slides:{type:"array",minItems:slideCount,maxItems:slideCount,items:{type:"object",additionalProperties:false,properties:{purpose:{type:"string"},headline:{type:"string"},lines:{type:"array",minItems:1,maxItems:5,items:{type:"string"}},visualDirection:{type:"string"}},required:["purpose","headline","lines","visualDirection"]}}},required:["title","subject","caption","slides"]};
  try {
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL?.trim()||"gpt-5.6-luna",input:[{role:"user",content:[{type:"input_text",text:[`Create exact copy for a ${slideCount}-slide Instagram carousel for Locked-In Supply.`,`Chosen topic: ${candidate.label}`,`Saved GFNF context: ${candidate.group.text}`,candidate.evergreen?"This source is stale. Use it only as inspiration for an evergreen educational framework. Include no dates, current stock, availability, prices, product claims, or retailer-specific assertions.":"Use only facts present in the saved context. Do not speculate.","Artwork copy must not name source creators, social platforms, retailers, entertainment franchises, characters, apps, or product brands. Caption may describe the general topic but must remain source-safe.","Keep headlines under 40 characters and each body line under 55 characters. Slide 1 hooks, middle slides teach, final slide gives a useful takeaway."].join("\n")}]}],text:{format:{type:"json_schema",name:"discord_carousel_plan",strict:true,schema}},max_output_tokens:1800}),signal:AbortSignal.timeout(120_000)});
    const payload=await response.json() as Record<string,unknown>&{error?:{message?:string}};
    if (!response.ok) throw new Error(payload.error?.message||`Planning failed (${response.status}).`);
    const raw=JSON.parse(outputText(payload)) as {title:string;subject:string;caption:string;slides:Array<{purpose:string;headline:string;lines:string[];visualDirection:string}>};
    const support=[candidate.evergreen?"Evergreen reframe; no time-sensitive source claim retained.":candidate.group.key];
    return {title:compact(raw.title,80),subject:compact(raw.subject,500),caption:compact(raw.caption,2200),topicStyleId:"educational",plan:{sourceContextKey:candidate.group.key,slides:raw.slides.map((slide,index)=>({position:index+1,purpose:slide.purpose,headline:slide.headline,lines:slide.lines,productKinds:[],factualSupport:support,visualDirection:slide.visualDirection}))}};
  } catch (error) {
    console.error("Discord planning fallback:",error instanceof Error?error.message:error);
    return fallbackPlan(candidate,slideCount);
  }
}

export function createPlannedDiscordCarousel(session:DiscordContentSession, planned:PlannedDiscordContent) {
  if (!session.referenceId || !session.sourceContext || !session.slideCount) throw new Error("The Discord session is missing its reference, source, or slide count.");
  return createCarouselSet({name:`Discord · ${planned.title}`,targetBrand:"Locked-In Supply",anchorReferenceId:session.referenceId,topicStyleId:planned.topicStyleId,slideCount:session.slideCount,subject:planned.subject,sourceContext:session.sourceContext,plan:planned.plan,prepareProductAssets:false});
}

export async function generateAndReviewDiscordSlide(session:DiscordContentSession, position:number, feedback?:string|null) {
  if (!session.carouselId) throw new Error("The session has no carousel.");
  try {
    const carousel=await generateCarouselSlide({carouselId:session.carouselId,position,instruction:feedback?.trim()||"Follow the persisted plan and shared visual system."});
    const slide=carousel?.slides.find((item)=>item.position===position);
    const file=getCarouselSlideFile(session.carouselId,position)?.file_name??null;
    const review=await reviewAutomatedCarouselSlide(session.carouselId,position);
    recordDiscordSlideAttempt({sessionId:session.id,carouselId:session.carouselId,position,fileName:file,status:review.passed?"generated":"review_failed",feedback,reviewPassed:review.passed,reviewNotes:[review.summary,...review.issues],costUsd:slide?.costUsd??null});
    return {carousel:getCarouselSet(session.carouselId)!,review};
  } catch (error) {
    recordDiscordSlideAttempt({sessionId:session.id,carouselId:session.carouselId,position,fileName:null,status:"failed",feedback,reviewPassed:false,reviewNotes:[error instanceof Error?error.message:"Generation failed."]});
    throw error;
  }
}

function zonedTenAm(date:string) {
  const [year,month,day]=date.split("-").map(Number);
  let guess=new Date(Date.UTC(year,month-1,day,10));
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(guess);
  const values=Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  const represented=Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day),Number(values.hour),Number(values.minute));
  guess=new Date(guess.getTime()+(Date.UTC(year,month-1,day,10)-represented));
  return guess.toISOString();
}

export async function proposeDiscordSchedule(session:DiscordContentSession, now=new Date()) {
  const scheduled=await listScheduledInstagramPosts(now,addDays(now,21)).catch(()=>[]);
  const occupied=new Set(scheduled.map((post)=>post.scheduledFor.slice(0,10)));
  const candidates:string[]=[];
  let nextMondayOffset=1;
  while(new Intl.DateTimeFormat("en-US",{timeZone:TIME_ZONE,weekday:"short"}).format(addDays(now,nextMondayOffset))!=="Mon") nextMondayOffset+=1;
  for (let offset=1;offset<=21;offset+=1) {
    const date=addDays(now,offset);
    const key=localDateKey(date,TIME_ZONE);
    const weekday=new Intl.DateTimeFormat("en-US",{timeZone:TIME_ZONE,weekday:"short"}).format(date);
    const allowed=session.evergreenReframe?offset>=nextMondayOffset&&["Mon","Wed","Fri","Sun"].includes(weekday):true;
    if (allowed&&!occupied.has(key)) candidates.push(zonedTenAm(key));
  }
  if (!candidates.length) throw new Error("No open publishing slots were found in the next three weeks.");
  if (!session.evergreenReframe) return {proposedFor:candidates[0],alternatives:candidates.slice(1,4)};
  const bestTimes=await getInstagramBestTimes().catch(()=>[]);
  const score=(slot:string)=> {
    const date=new Date(slot);
    return bestTimes.find((candidate)=>candidate.day_of_week===date.getUTCDay()&&candidate.hour===date.getUTCHours())?.avg_engagement ?? 0;
  };
  const firstWeek=candidates.filter((slot)=>Date.parse(slot)<addDays(now,nextMondayOffset+7).getTime()).sort((left,right)=>score(right)-score(left)||Date.parse(left)-Date.parse(right));
  const ordered=[...firstWeek,...candidates.filter((slot)=>!firstWeek.includes(slot))];
  return {proposedFor:ordered[0],alternatives:ordered.slice(1,4)};
}

export async function scheduleDiscordSession(session:DiscordContentSession) {
  if (!session.carouselId||!session.proposedFor||!session.caption) throw new Error("The session is not ready to schedule.");
  if (session.zernioPostId) return session;
  const carousel=getCarouselSet(session.carouselId);
  if (!carousel||carousel.slides.some((slide)=>slide.status!=="kept"||!slide.imageUrl)) throw new Error("Every slide must be approved before scheduling.");
  const result=await scheduleInstagramCarousel({imageUrls:carousel.slides.map((slide)=>slide.imageUrl!),caption:session.caption,scheduledFor:session.proposedFor});
  return updateDiscordSession(session.id,{status:"scheduled",zernioPostId:result.postId,error:null});
}

export function savedDiscordReferences() { return listSavedImageReferences(); }
export function approveDiscordSlide(session:DiscordContentSession,position:number) {
  if (!session.carouselId) throw new Error("The session has no carousel.");
  const file=getCarouselSlideFile(session.carouselId,position);
  const carousel=updateCarouselSlide({carouselId:session.carouselId,position,status:"kept",fileName:file?.file_name??null});
  if (!carousel) throw new Error("Carousel not found.");
  return carousel;
}
