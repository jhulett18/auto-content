import { fetchGfnfContextForDate } from "./gfnf-context";
import { candidateSignals, consolidateDailyStories, localDateKey, nextDefaultPublishTime, parsePublishDirective, previousLocalDate, publishTimeOnDate, qualifiesForDailyCarousel, rankDailyCandidates } from "./daily-keywords";
import {
  acquireAutomationLease, getAutomationContext, getAutomationMeta, getAutomationRun, getOrCreateAutomationRun,
  getPendingAutomationRun, persistAutomationGroups, releaseAutomationLease, saveAutomationVariation, setAutomationMeta,
  updateAutomationRun, updateAutomationVariation,
} from "./automation-db";
import { createCarouselSet, getCarouselSet, listSavedImageReferences, updateCarouselSlide } from "./references-db";
import { generateCarouselSlide } from "./openai-generation";
import { reviewAutomatedCarousel } from "./automated-review";
import { escapeHtml, sendTelegramMessage } from "./telegram";
import { scheduleInstagramCarousel } from "./zernio";
import { getDiscordDecision, sendDiscordApproval, sendDiscordDailyReport, sendDiscordIdeaAlert, sendDiscordNoCandidate, sendDiscordScheduled } from "./discord";
import type { CarouselPlan, DailyCandidateSignals, DailyWorkflowRun, DraftContextGroup, ReferenceAsset } from "./reference-types";

const TIME_ZONE = process.env.AUTOMATION_TIMEZONE?.trim() || "America/New_York";
const DEFAULT_POST_TIME = process.env.AUTOMATION_DEFAULT_POST_TIME?.trim() || "10:00";
function clipped(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trim()}…`;
}

function extractLabelValues(text: string) {
  const matches = [...text.matchAll(/\b(available stock|retail|price|sku|pid|limit|max|qty|quantity)\s*:?\s*([^|]{1,45}?)(?=\s+(?:available stock|retail|price|sku|pid|limit|max|qty|quantity|link)\s*:|$)/gi)];
  return matches.map((match) => `${match[1].toUpperCase()}: ${clipped(match[2], 34)}`).slice(0, 5);
}

function automatedPlan(context: DraftContextGroup, signals: DailyCandidateSignals, variation: "A" | "B"): CarouselPlan {
  const event = signals.events[0]?.toUpperCase() || "MARKET";
  const retailer = context.text.match(/\b(Target|Walmart|Menards|PKC|EQL|RunFair)\b/i)?.[0]?.toUpperCase();
  const timing = context.text.match(/\b(?:tonight|tomorrow|today|live|release day|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:EST|ET|PDT|PT)?|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/i)?.[0]?.toUpperCase();
  const productLines = context.products.length
    ? context.products.map((product) => `${product.label.toUpperCase()} — LIMIT ${product.limit}`)
    : extractLabelValues(context.text);
  const support = [context.key];
  const direction = variation === "A" ? "Bold editorial geometry with strong contrast and a direct news rhythm." : "Clean modular editorial layout with quieter pacing and a data-led rhythm.";
  return { sourceContextKey: context.key, slides: [
    { position:1, purpose:"Lead with the highest-signal event and timing.", headline:`${event} ALERT`, lines:[retailer || "COLLECTIBLES UPDATE", timing || "NEW INFORMATION DETECTED"], productKinds:[], factualSupport:support, visualDirection:direction },
    { position:2, purpose:"Summarize only confirmed actionable details.", headline:"WHAT'S CONFIRMED", lines:productLines.length ? productLines.slice(0,6) : ["DETAILS CAPTURED FROM SOURCE", "CHECK THE ORIGINAL UPDATE"], productKinds:[], factualSupport:support, visualDirection:direction },
    { position:3, purpose:"Close with timing and a verification caveat.", headline:"BEFORE YOU ACT", lines:[timing ? `TIMING: ${timing}` : "TIMING MAY CHANGE", "VERIFY PRICE, LIMITS, AND AVAILABILITY", "CHECK THE SOURCE UPDATE"], productKinds:[], factualSupport:support, visualDirection:direction },
  ] };
}

function referenceName(reference: ReferenceAsset) {
  return reference.savedName || `@${reference.creatorHandle} · ${reference.platform}`;
}

async function createVariation(run: DailyWorkflowRun, context: DraftContextGroup, reference: ReferenceAsset, label: "A" | "B") {
  const signals = run.signals || candidateSignals(context);
  const carousel = createCarouselSet({
    name: `${run.runDate} Daily ${label}`, targetBrand:"Locked-In Supply", anchorReferenceId:reference.id,
    topicStyleId: label === "A" ? "market_alert" : "news_update", slideCount:3, subject:context.text,
    sourceContext:context, plan:automatedPlan(context, signals, label), prepareProductAssets:false,
  });
  saveAutomationVariation(run.id, label, carousel.id);
  updateAutomationVariation(run.id, label, {status:"generating",reviewStatus:"pending",reviewNotes:[],error:null});
  try {
    for (let position = 1; position <= 3; position += 1) await generateCarouselSlide({carouselId:carousel.id,position,instruction:`Automated variation ${label}. Follow the persisted plan and its visual direction.`});
    const review = await reviewAutomatedCarousel(carousel.id);
    updateAutomationVariation(run.id, label, {status:review.passed ? "ready" : "failed",reviewStatus:review.passed ? "passed" : "failed",reviewNotes:review.notes,error:review.passed ? null : "Automated pre-approval review failed."});
    if (!review.passed) throw new Error(`Variation ${label} failed automated review.`);
  } catch (error) {
    updateAutomationVariation(run.id, label, {status:"failed",reviewStatus:"failed",error:error instanceof Error ? error.message : "Variation generation failed."});
    throw error;
  }
}

async function generateRunVariations(runId: string, reference: ReferenceAsset) {
  let run = getAutomationRun(runId);
  if (!run?.candidateKey) throw new Error("The automation run has no source candidate.");
  const context = getAutomationContext(run.candidateKey);
  if (!context) throw new Error("The source context is no longer available.");
  run = updateAutomationRun(run.id, {status:"generating",referenceId:reference.id,referenceName:referenceName(reference),error:null});
  await createVariation(run, context, reference, "A");
  await createVariation(getAutomationRun(run.id)!, context, reference, "B");
  run = getAutomationRun(run.id)!;
  let discordMessageId: string | null = null;
  try {
    discordMessageId = await sendDiscordApproval(run);
  } catch (error) {
    await sendTelegramMessage(`<b>Discord preview delivery failed</b>\n${escapeHtml(error instanceof Error ? error.message : "Unknown Discord error.")}`);
  }
  return updateAutomationRun(run.id, {status:"awaiting_approval",discordMessageId,error:null});
}

async function scheduleApproved(run: DailyWorkflowRun) {
  const variation = run.variations.find((candidate) => candidate.label === run.approvedVariation);
  if (!variation || variation.reviewStatus !== "passed") throw new Error("The approved variation is not ready to schedule.");
  const carousel = getCarouselSet(variation.carouselId);
  if (!carousel) throw new Error("The approved carousel is missing.");
  let scheduledFor = run.scheduledFor || nextDefaultPublishTime(new Date(), TIME_ZONE, DEFAULT_POST_TIME);
  if (Date.parse(scheduledFor) <= Date.now()) scheduledFor = nextDefaultPublishTime(new Date(), TIME_ZONE, DEFAULT_POST_TIME);
  const result = await scheduleInstagramCarousel({imageUrls:carousel.slides.map((slide) => slide.imageUrl!).filter(Boolean),caption:run.caption || carousel.subject,scheduledFor});
  for (const slide of carousel.slides) updateCarouselSlide({carouselId:carousel.id,position:slide.position,status:"kept",fileName:undefined});
  updateAutomationVariation(run.id, variation.label, {status:"approved"});
  const rejected = run.approvedVariation === "A" ? "B" : "A";
  updateAutomationVariation(run.id, rejected, {status:"rejected"});
  const updated = updateAutomationRun(run.id, {status:"scheduled",scheduledFor:result.scheduledFor,zernioPostId:result.postId,error:null});
  await sendTelegramMessage(`<b>Instagram carousel scheduled</b>\n\nVariation ${run.approvedVariation}\nScheduled: ${new Intl.DateTimeFormat("en-US", {dateStyle:"medium",timeStyle:"short",timeZone:TIME_ZONE}).format(new Date(result.scheduledFor))}\nZernio post: ${result.postId || "created"}`);
  try {
    await sendDiscordScheduled(updated);
  } catch (error) {
    await sendTelegramMessage(`<b>Discord scheduling confirmation failed</b>\n${escapeHtml(error instanceof Error ? error.message : "Unknown Discord error.")}`);
  }
  return updated;
}

async function processDiscordApproval() {
  const pending = getPendingAutomationRun();
  if (!pending || pending.status !== "awaiting_approval") return { decision: null };
  const decision = await getDiscordDecision(pending.discordMessageId);
  if (decision === "A" || decision === "B") {
    updateAutomationRun(pending.id, { status: "approved", approvedVariation: decision });
    await scheduleApproved(getAutomationRun(pending.id)!);
  } else if (decision === "reject") {
    updateAutomationRun(pending.id, { status: "rejected", error: null });
    updateAutomationVariation(pending.id, "A", { status: "rejected" }); updateAutomationVariation(pending.id, "B", { status: "rejected" });
    await sendTelegramMessage(`Discord rejected run ${pending.id}.`);
  }
  return { decision };
}

async function sendSavedReferenceList() {
  const references = listSavedImageReferences();
  await sendTelegramMessage(references.length ? `<b>Saved references</b>\n${references.map((reference) => `• ${escapeHtml(referenceName(reference))} — <code>${reference.id.slice(0,8)}</code>`).join("\n")}` : "No saved image references are available. Save one in the reference library first.");
}

async function closeDailyRun(runDate: string, groups: DraftContextGroup[], now: Date) {
  let run = getOrCreateAutomationRun(runDate);
  if (run.status !== "collecting" && run.status !== "failed") return run;
  const ranked = rankDailyCandidates(groups);
  const top = ranked[0];
  if (!top) {
    run = updateAutomationRun(run.id, {status:"no_candidate",error:null});
    await sendTelegramMessage(`No GFNF message qualified for the ${runDate} daily carousel.`);
    try { await sendDiscordNoCandidate(runDate); } catch (error) { await sendTelegramMessage(`<b>Discord no-candidate notice failed</b>\n${escapeHtml(error instanceof Error ? error.message : "Unknown Discord error.")}`); }
    return run;
  }
  const references = listSavedImageReferences();
  if (!references.length) {
    run = updateAutomationRun(run.id, {status:"failed",candidateKey:top.group.key,candidateText:top.group.text,candidateTimestamp:top.group.timestamp,signals:top.signals,error:"No saved image reference is available."});
    await sendTelegramMessage("Daily carousel generation stopped because no saved image reference is available.");
    return run;
  }
  const scheduledFor = parsePublishDirective(top.group.text, TIME_ZONE) || publishTimeOnDate(localDateKey(now, TIME_ZONE), TIME_ZONE, DEFAULT_POST_TIME);
  const caption = clipped(top.group.text, 2_050);
  run = updateAutomationRun(run.id, {status:"generating",candidateKey:top.group.key,candidateText:top.group.text,candidateTimestamp:top.group.timestamp,signals:top.signals,caption,scheduledFor,error:null});
  try {
    return await generateRunVariations(run.id, references[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Daily carousel generation failed.";
    await sendTelegramMessage(`<b>Daily carousel generation failed</b>\n${escapeHtml(message)}`);
    return updateAutomationRun(run.id, {status:"failed",error:message});
  }
}

export async function runDailyAutomation(options: {mode:"intake"|"nightly"|"generate"|"approval"|"report";now?:Date}) {
  const holder = acquireAutomationLease("daily-workflow");
  if (!holder) return {status:"skipped",reason:"Another automation run is active."};
  const now = options.now ?? new Date();
  try {
    if (options.mode === "approval") {
      const decision = await processDiscordApproval();
      return {status:"ok",mode:options.mode,...decision};
    }
    const today = localDateKey(now, TIME_ZONE);
    if (options.mode === "intake") {
      const exported = await fetchGfnfContextForDate(today, TIME_ZONE);
      const stories = consolidateDailyStories(exported.groups);
      const imported = persistAutomationGroups(stories, (group) => candidateSignals(group, now), qualifiesForDailyCarousel);
      const ranked = rankDailyCandidates(stories);
      let urgent = 0;
      for (const candidate of ranked.slice(0, 3)) {
        if (candidate.signals.urgency.length && candidate.signals.score >= 8) {
          const key = `alert:${candidate.group.key}`;
          if (!getAutomationMeta(key)) { await sendDiscordIdeaAlert(candidate.group, candidate.signals); setAutomationMeta(key, new Date().toISOString()); }
          urgent += 1;
        }
      }
      return {status:"ok",mode:options.mode,targetDate:today,sourceRecords:exported.sourceRecordCount,groups:stories.length,imported,urgent};
    }
    if (options.mode === "report") {
      const targetDate = previousLocalDate(now, TIME_ZONE);
      const exported = await fetchGfnfContextForDate(targetDate, TIME_ZONE);
      const stories = consolidateDailyStories(exported.groups);
      const run = getOrCreateAutomationRun(targetDate);
      await sendDiscordDailyReport({date:targetDate,scanned:exported.sourceRecordCount,ideas:stories.length,urgent:stories.filter((group) => candidateSignals(group, now).urgency.length > 0).length,run});
      return {status:"ok",mode:options.mode,targetDate,sourceRecords:exported.sourceRecordCount,groups:stories.length,run};
    }
    const targetDate = previousLocalDate(now, TIME_ZONE);
    const exported = await fetchGfnfContextForDate(targetDate, TIME_ZONE);
    const stories = consolidateDailyStories(exported.groups);
    const imported = persistAutomationGroups(stories, (group) => candidateSignals(group, now), qualifiesForDailyCarousel);
    const finalRun = await closeDailyRun(targetDate, stories, now);
    return {status:"ok",mode:options.mode,targetDate,sourceRecords:exported.sourceRecordCount,groups:stories.length,imported,run:finalRun};
  } finally {
    releaseAutomationLease("daily-workflow", holder);
  }
}
