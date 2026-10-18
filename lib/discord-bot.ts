import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction,
  Client, EmbedBuilder, Events, GatewayIntentBits, Interaction, ModalBuilder, ModalSubmitInteraction, REST, Routes,
  SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { getCarouselSet } from "./references-db";
import { discordCarouselCost, discordCarouselImageFiles } from "./discord-generation";
import {
  approveDiscordSlide, createPlannedDiscordCarousel, generateAndReviewDiscordSlide, listDiscordTopicCandidates,
  planDiscordContent, proposeDiscordSchedule, savedDiscordReferences, scheduleDiscordSession, syncDiscordGfnf,
  type DiscordTopicCandidate,
} from "./discord-workflow";
import {
  claimDiscordInteraction, createDiscordSession, getActiveDiscordSession, getDiscordSession, getLatestDiscordAttempt,
  listSavedDiscordSessions, setLatestDiscordAttemptStatus, updateDiscordSession, type DiscordContentSession, type DiscordWorkflowStatus,
} from "./discord-workflow-db";
import type { CarouselSet } from "./reference-types";
import { readReferenceImage } from "./reference-media-cache";
import { discordReferencePostUrl, discordReferenceTitle, paginateDiscordReferences } from "./discord-workflow-policy";
import { discordApproverIds } from "./discord-approvers";

const PREFIX="wf";
let generationSession:string|null=null;

function configuration() {
  const token=process.env.DISCORD_BOT_TOKEN?.trim(); const guildId=process.env.DISCORD_GUILD_ID?.trim();
  const channelId=process.env.DISCORD_APPROVAL_CHANNEL_ID?.trim(); const approverIds=discordApproverIds();
  if (!token||!guildId||!channelId||!approverIds.length) throw new Error("Configure DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_APPROVAL_CHANNEL_ID, and DISCORD_APPROVER_USER_IDS.");
  return {token,guildId,channelId,approverIds};
}

export const startCommand=new SlashCommandBuilder().setName("start").setDescription("Start or resume a guided social carousel workflow");

export async function registerDiscordCommands(token:string,applicationId:string,guildId:string) {
  await new REST({version:"10"}).setToken(token).put(Routes.applicationGuildCommands(applicationId,guildId),{body:[startCommand.toJSON()]});
}

function allowed(interaction:Interaction) {
  const {channelId,approverIds}=configuration();
  return interaction.channelId===channelId&&approverIds.includes(interaction.user.id);
}

function button(id:string,label:string,style=ButtonStyle.Secondary,disabled=false) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }
function cancelButton(sessionId:string) { return button(`${PREFIX}:cancel:${sessionId}`,"Cancel",ButtonStyle.Danger); }
function row(...items:ButtonBuilder[]) { return new ActionRowBuilder<ButtonBuilder>().addComponents(items); }
function formatTime(value:string) { return new Intl.DateTimeFormat("en-US",{dateStyle:"full",timeStyle:"short",timeZone:process.env.AUTOMATION_TIMEZONE?.trim()||"America/New_York"}).format(new Date(value)); }

function cancelConfirmation(session:DiscordContentSession) {
  return {
    content:"**Save this session for later?**\nYour topic, reference, plan, and approvals are already saved. Saving keeps the workflow available through `/start` → **Resume**. Discarding closes it.",
    embeds:[], files:[], attachments:[],
    components:[row(button(`${PREFIX}:save:${session.id}`,"Save for later",ButtonStyle.Primary),button(`${PREFIX}:discard:${session.id}`,"Discard session",ButtonStyle.Danger))],
  };
}

function progressLabel(status:DiscordWorkflowStatus|null) {
  const labels:Partial<Record<DiscordWorkflowStatus,string>>={
    topic_selection:"Waiting for topic", reference_selection:"Topic selected", slide_count:"Reference selected",
    plan_review:"Plan ready", slide_1_review:"Slide 1 ready", remaining_generation:"Generating remaining slides",
    slide_review:"Reviewing slides", final_review:"Carousel ready", schedule_review:"Reviewing schedule",
  };
  return status ? labels[status]||status.replaceAll("_"," ") : "Saved workflow";
}

function savedSessionPicker(channelId:string,userId:string) {
  const sessions=listSavedDiscordSessions(channelId,userId);
  if (!sessions.length) return {content:"There are no saved sessions to resume.",embeds:[],files:[],attachments:[],components:[row(button(`${PREFIX}:start-new:${userId}`,"Start new",ButtonStyle.Primary))]};
  const refs=savedDiscordReferences();
  const details=sessions.map((session,index)=> {
    const reference=refs.find((item)=>item.id===session.referenceId);
    const facts=[progressLabel(session.resumeStatus),reference?`Ref: ${discordReferenceTitle(reference)}`:null,session.slideCount?`${session.slideCount} slides`:null].filter(Boolean).join(" · ");
    return `**${index+1}. ${session.topicLabel||"Untitled session"}**\n${facts}\nSaved <t:${Math.floor(Date.parse(session.updatedAt)/1000)}:R>`;
  });
  const menu=new StringSelectMenuBuilder().setCustomId(`${PREFIX}:saved-session:${userId}`).setPlaceholder("Choose a saved session")
    .addOptions(sessions.map((session,index)=>({label:`${index+1}. ${session.topicLabel||"Untitled session"}`.slice(0,100),description:progressLabel(session.resumeStatus).slice(0,100),value:session.id})));
  return {content:`**Choose a session to resume**\n\n${details.join("\n\n")}`.slice(0,2000),embeds:[],files:[],attachments:[],components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),row(button(`${PREFIX}:start-new:${userId}`,"Start new instead"))]};
}

function topicScreen(session:DiscordContentSession) {
  const candidates=listDiscordTopicCandidates();
  if (!candidates.length) return {content:"No safe saved GFNF topics are available yet. The bot syncs hourly; run `/start` again after a new source update is saved.",components:[row(cancelButton(session.id))]};
  const menu=new StringSelectMenuBuilder().setCustomId(`${PREFIX}:topic:${session.id}`).setPlaceholder("Choose a saved GFNF topic")
    .addOptions(candidates.map((candidate,index)=>({label:`${index+1}. ${candidate.label}`.slice(0,100),description:((candidate.evergreen?"Evergreen reframe · ":"")+candidate.reason).slice(0,100),value:candidate.group.key})));
  const lines=candidates.map((candidate,index)=>`**${index+1}. ${candidate.label}**\n${candidate.summary}\nSource: <t:${Math.floor(Date.parse(candidate.group.timestamp)/1000)}:R>`);
  return {content:`**Choose a topic**\n\n${lines.join("\n\n")}`.slice(0,2000),components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),row(cancelButton(session.id))]};
}

async function referenceScreen(session:DiscordContentSession,page=session.referencePage) {
  const refs=savedDiscordReferences(); const paged=paginateDiscordReferences(refs,page); const pages=paged.pages; const safePage=paged.page;
  const visible=paged.items;
  if (!visible.length) return {content:"No saved image references are available. Save one in the reference library first.",embeds:[],components:[row(cancelButton(session.id))]};
  const menu=new StringSelectMenuBuilder().setCustomId(`${PREFIX}:reference:${session.id}`).setPlaceholder("Choose a reference")
    .addOptions(visible.map((reference)=>({label:discordReferenceTitle(reference),value:reference.id})));
  const previews=await Promise.all(visible.map(async (reference,index)=> {
    try {
      const name=`reference-${safePage+1}-${index+1}.webp`;
      return {name,file:new AttachmentBuilder(await readReferenceImage(reference.id,"thumbnail"),{name})};
    } catch {
      return null;
    }
  }));
  const embeds=visible.map((reference,index)=> {
    const embed=new EmbedBuilder().setTitle(discordReferenceTitle(reference));
    const postUrl=discordReferencePostUrl(reference);
    if (postUrl) embed.setURL(postUrl).setDescription(`[Open original post ↗](${postUrl})`);
    const preview=previews[index];
    if (preview) embed.setImage(`attachment://${preview.name}`);
    return embed;
  });
  return {content:`**Choose a reference** · Page ${safePage+1}/${pages}`,embeds,files:previews.flatMap((preview)=>preview?[preview.file]:[]),attachments:[],components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),row(button(`${PREFIX}:refs:${session.id}:${safePage-1}`,"Previous",ButtonStyle.Secondary,safePage===0),button(`${PREFIX}:refs:${session.id}:${safePage+1}`,"Next",ButtonStyle.Secondary,safePage>=pages-1),cancelButton(session.id))]};
}

async function slideCountScreen(session:DiscordContentSession) {
  const reference=savedDiscordReferences().find((candidate)=>candidate.id===session.referenceId);
  const embeds:EmbedBuilder[]=[]; const files:AttachmentBuilder[]=[];
  if (reference) {
    const postUrl=discordReferencePostUrl(reference);
    const embed=new EmbedBuilder().setTitle(discordReferenceTitle(reference));
    if (postUrl) embed.setURL(postUrl).setDescription(`[Open original post ↗](${postUrl})`);
    try {
      const name="selected-reference.webp";
      files.push(new AttachmentBuilder(await readReferenceImage(reference.id,"thumbnail"),{name}));
      embed.setImage(`attachment://${name}`);
    } catch {
      // The title and source link still let the user confirm the selected reference.
    }
    embeds.push(embed);
  }
  return {content:`**Reference selected**\n${reference?discordReferenceTitle(reference):"Saved reference"}\n\nHow many slides should this topic use?`,embeds,files,attachments:[],components:[row(button(`${PREFIX}:count:${session.id}:3`,"3 slides",ButtonStyle.Primary),button(`${PREFIX}:count:${session.id}:4`,"4 slides",ButtonStyle.Primary),cancelButton(session.id))]};
}

function planScreen(session:DiscordContentSession,carousel:CarouselSet) {
  const slides=carousel.plan?.slides.map((slide)=>`**Slide ${slide.position}: ${slide.headline}**\n${slide.lines.join(" · ")}\n_${slide.purpose}_`).join("\n\n")||"Plan unavailable.";
  const caption=new EmbedBuilder().setTitle("Planned caption").setDescription((session.caption||"No caption planned.").slice(0,4096));
  return {content:`**Review exact copy before generation**\n${session.evergreenReframe?"Source mode: evergreen reframe; expired claims removed.\n":"Source mode: current saved GFNF context.\n"}\n${slides}`.slice(0,2000),embeds:[caption],attachments:[],components:[row(button(`${PREFIX}:generate:${session.id}`,"Generate slide 1",ButtonStyle.Success),button(`${PREFIX}:change-ref:${session.id}`,"Change reference"),cancelButton(session.id))]};
}

function slideFile(carousel:CarouselSet,position:number) { const file=discordCarouselImageFiles(carousel).find((candidate)=>candidate.position===position); return file ? [new AttachmentBuilder(file.path,{name:file.name})] : []; }
function slideReviewScreen(session:DiscordContentSession,carousel:CarouselSet,position:number) {
  const attempt=getLatestDiscordAttempt(session.id,position); const passed=attempt?.review_passed===1;
  const notes=attempt ? JSON.parse(attempt.review_notes_json) as string[] : ["Automated review result unavailable."];
  const controls=[button(`${PREFIX}:approve:${session.id}:${position}`,`Approve slide ${position}`,ButtonStyle.Success,!passed),button(`${PREFIX}:deny:${session.id}:${position}`,`Deny / retry slide ${position}`,ButtonStyle.Danger)];
  if (position===1&&carousel.slides[0].status!=="kept") controls.push(button(`${PREFIX}:change-ref:${session.id}`,"Change reference"));
  controls.push(cancelButton(session.id));
  return {content:`**Slide ${position}/${carousel.slideCount}**\nAutomated review: **${passed?"passed":"needs attention"}**\n${notes.join("\n")}\nRecorded carousel cost: $${discordCarouselCost(carousel).toFixed(4)}`.slice(0,2000),embeds:[],files:slideFile(carousel,position),components:[row(...controls)]};
}

function remainingReviewScreen(session:DiscordContentSession,carousel:CarouselSet) {
  const pending=carousel.slides.filter((slide)=>slide.position>1&&slide.status!=="kept");
  const lines=carousel.slides.filter((slide)=>slide.position>1).map((slide)=>{const attempt=getLatestDiscordAttempt(session.id,slide.position);return `Slide ${slide.position}: ${slide.status==="kept"?"approved":attempt?.review_passed===1?"ready for approval":"needs retry"}`;});
  const rows=pending.map((slide)=>row(button(`${PREFIX}:approve:${session.id}:${slide.position}`,`Approve slide ${slide.position}`,ButtonStyle.Success,getLatestDiscordAttempt(session.id,slide.position)?.review_passed!==1),button(`${PREFIX}:deny:${session.id}:${slide.position}`,`Deny / retry ${slide.position}`,ButtonStyle.Danger)));
  rows.push(row(cancelButton(session.id)));
  return {content:`**Review remaining slides**\n${lines.join("\n")}`,embeds:[],files:discordCarouselImageFiles(carousel).filter((file)=>file.position>1).map((file)=>new AttachmentBuilder(file.path,{name:file.name})),components:rows};
}

function finalScreen(session:DiscordContentSession,carousel:CarouselSet) {
  const caption=new EmbedBuilder().setTitle("Final caption").setDescription((session.caption||"No caption planned.").slice(0,4096));
  return {content:`**Final carousel review**\n${carousel.slideCount} approved slides · Cost $${discordCarouselCost(carousel).toFixed(4)}\nNothing publishes until you review the schedule.`,embeds:[caption],files:discordCarouselImageFiles(carousel).map((file)=>new AttachmentBuilder(file.path,{name:file.name})),components:[row(button(`${PREFIX}:review-time:${session.id}`,"Review posting time",ButtonStyle.Primary),cancelButton(session.id))]};
}

function scheduleScreen(session:DiscordContentSession) {
  return {content:`**Proposed Instagram schedule**\n${formatTime(session.proposedFor!)}\n\nApprove to create the real scheduled Instagram carousel in Zernio.`,embeds:[],components:[row(button(`${PREFIX}:schedule:${session.id}`,"Approve and schedule",ButtonStyle.Success),button(`${PREFIX}:other-time:${session.id}`,"Choose another slot"),cancelButton(session.id))]};
}

async function rejectUnauthorized(interaction:Interaction) { if(interaction.isRepliable()) await interaction.reply({content:"This workflow is limited to the configured approver and channel.",ephemeral:true}); }
function requireSession(id:string,userId:string,channelId:string|null) { const session=getDiscordSession(id); if(!session||session.userId!==userId||session.channelId!==channelId) throw new Error("Workflow session not found."); return session; }
function claim(interaction:Interaction) { if(!claimDiscordInteraction(interaction.id)) throw new Error("This interaction was already processed."); }

async function sessionScreen(session:DiscordContentSession) {
  if(session.status==="topic_selection") return topicScreen(session);
  if(session.status==="reference_selection") return referenceScreen(session);
  if(session.status==="slide_count") return slideCountScreen(session);
  const carousel=session.carouselId?getCarouselSet(session.carouselId):undefined;
  if(session.status==="plan_review"&&carousel) return planScreen(session,carousel);
  if(session.status==="slide_1_review"&&carousel) return slideReviewScreen(session,carousel,1);
  if(session.status==="slide_review"&&carousel) return remainingReviewScreen(session,carousel);
  if(session.status==="final_review"&&carousel) return finalScreen(session,carousel);
  if(session.status==="schedule_review") return scheduleScreen(session);
  return {content:`Session ${session.id} is ${session.status}. Discard it and start again if it was interrupted.`,embeds:[],files:[],attachments:[],components:[row(cancelButton(session.id))]};
}

async function resume(interaction:ChatInputCommandInteraction|ButtonInteraction,session:DiscordContentSession) {
  await interaction.deferReply({ephemeral:false});
  return interaction.editReply(await sessionScreen(session));
}

async function handleStart(interaction:ChatInputCommandInteraction) {
  if(!allowed(interaction)) return rejectUnauthorized(interaction);
  const active=getActiveDiscordSession(interaction.channelId,interaction.user.id);
  if(active) return interaction.reply({content:`A workflow is already active at **${active.status.replaceAll("_"," ")}**.`,components:[row(button(`${PREFIX}:resume:${active.id}`,"Resume",ButtonStyle.Primary),cancelButton(active.id))],ephemeral:true});
  const saved=listSavedDiscordSessions(interaction.channelId,interaction.user.id);
  if(saved.length) return interaction.reply({content:`You have ${saved.length} saved session${saved.length===1?"":"s"}.`,components:[row(button(`${PREFIX}:resume-list:${interaction.user.id}`,"Resume session",ButtonStyle.Primary),button(`${PREFIX}:start-new:${interaction.user.id}`,"Start new"))],ephemeral:true});
  const session=createDiscordSession(interaction.channelId,interaction.user.id); await interaction.reply(topicScreen(session));
}

async function handleSelect(interaction:StringSelectMenuInteraction) {
  if(!allowed(interaction)) return rejectUnauthorized(interaction); claim(interaction);
  const [,action,id]=interaction.customId.split(":");
  if(action==="saved-session") {
    if(id!==interaction.user.id) throw new Error("This saved-session picker belongs to another user.");
    let saved=requireSession(interaction.values[0],interaction.user.id,interaction.channelId);
    if(saved.status!=="saved"||!saved.resumeStatus) throw new Error("That session is no longer available to resume.");
    saved=updateDiscordSession(saved.id,{status:saved.resumeStatus,resumeStatus:null});
    await interaction.deferUpdate();
    return interaction.editReply(await sessionScreen(saved));
  }
  let session=requireSession(id,interaction.user.id,interaction.channelId);
  if(action==="topic") {
    if(session.status!=="topic_selection") throw new Error("This topic selector is no longer active.");
    const candidate=listDiscordTopicCandidates().find((item)=>item.group.key===interaction.values[0]); if(!candidate) throw new Error("That topic is no longer available.");
    session=updateDiscordSession(id,{status:"reference_selection",sourceContextKey:candidate.group.key,sourceContext:candidate.group,topicLabel:candidate.label,evergreenReframe:candidate.evergreen,referencePage:0});
    await interaction.deferUpdate();
    return interaction.editReply(await referenceScreen(session));
  }
  if(action==="reference") {
    if(session.status!=="reference_selection") throw new Error("This reference selector is no longer active.");
    const prior=session.carouselId?getCarouselSet(session.carouselId):undefined;
    session=updateDiscordSession(id,{status:prior?.plan?"plan_review":"slide_count",referenceId:interaction.values[0]});
    if(prior?.plan&&session.sourceContext&&session.slideCount) {
      const replacement=createPlannedDiscordCarousel(session,{plan:prior.plan,caption:session.caption||"",title:prior.name.replace(/^Discord · /,""),subject:prior.subject,topicStyleId:prior.topicStyleId});
      session=updateDiscordSession(id,{carouselId:replacement.id});
      return interaction.update(planScreen(session,replacement));
    }
    await interaction.deferUpdate();
    return interaction.editReply(await slideCountScreen(session));
  }
  if(action==="slot") { if(session.status!=="schedule_review") throw new Error("This time selector is no longer active."); session=updateDiscordSession(id,{status:"schedule_review",proposedFor:interaction.values[0]}); return interaction.update(scheduleScreen(session)); }
}

async function generateRemaining(interaction:ButtonInteraction,session:DiscordContentSession) {
  if(!session.carouselId||!session.slideCount) throw new Error("Carousel is missing."); generationSession=session.id;
  const carouselId=session.carouselId; const slideCount=session.slideCount;
  session=updateDiscordSession(session.id,{status:"remaining_generation"});
  await interaction.update({content:"Slide 1 approved. Generating and reviewing the remaining slides…",embeds:[],files:[],components:[]});
  try { for(let position=2;position<=slideCount;position+=1){await interaction.editReply({content:`Generating and reviewing slide ${position}/${slideCount}…`}); try{await generateAndReviewDiscordSlide(session,position);}catch(error){console.error(`Slide ${position} failed:`,error instanceof Error?error.message:error);}} }
  finally {generationSession=null;}
  session=updateDiscordSession(session.id,{status:"slide_review"}); const carousel=getCarouselSet(carouselId)!; await interaction.editReply(remainingReviewScreen(session,carousel));
}

async function handleButton(interaction:ButtonInteraction) {
  if(!allowed(interaction)) return rejectUnauthorized(interaction);
  const [,action,id,arg]=interaction.customId.split(":");
  if(action==="resume-list") { if(id!==interaction.user.id) throw new Error("This session picker belongs to another user."); claim(interaction); return interaction.update(savedSessionPicker(interaction.channelId,interaction.user.id)); }
  if(action==="start-new") { if(id!==interaction.user.id) throw new Error("This action belongs to another user."); claim(interaction); const active=getActiveDiscordSession(interaction.channelId,interaction.user.id); if(active) return interaction.update({content:"Another session is already active. Run `/start` again to resume it.",embeds:[],files:[],attachments:[],components:[]}); const fresh=createDiscordSession(interaction.channelId,interaction.user.id); return interaction.update(topicScreen(fresh)); }
  const initial=requireSession(id,interaction.user.id,interaction.channelId);
  if(action==="deny") {
    if(!["slide_1_review","slide_review"].includes(initial.status)) return interaction.reply({content:"This slide review is no longer active.",ephemeral:true});
    const modal=new ModalBuilder().setCustomId(`${PREFIX}:retry-modal:${id}:${arg}`).setTitle(`Retry slide ${arg}`);
    const input=new TextInputBuilder().setCustomId("feedback").setLabel("What should change?").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500).setPlaceholder("Example: simplify the layout and increase contrast");
    return interaction.showModal(modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
  }
  claim(interaction); let session=initial;
  if(action==="cancel") return interaction.update(cancelConfirmation(session));
  if(action==="save") { updateDiscordSession(id,{status:"saved",resumeStatus:session.status}); return interaction.update({content:"**Session saved for later.**\nRun `/start` when you are ready, choose **Resume session**, then select this workflow.",embeds:[],files:[],attachments:[],components:[]}); }
  if(action==="discard") { updateDiscordSession(id,{status:"cancelled"}); return interaction.update({content:"Session discarded. Nothing was scheduled.",embeds:[],files:[],attachments:[],components:[]}); }
  if(action==="resume") return resume(interaction,session);
  if(action==="refs") { if(session.status!=="reference_selection") throw new Error("This reference browser is no longer active."); session=updateDiscordSession(id,{referencePage:Number(arg)}); await interaction.deferUpdate(); return interaction.editReply(await referenceScreen(session,Number(arg))); }
  if(action==="change-ref") { if(!["plan_review","slide_1_review"].includes(session.status)) throw new Error("The reference can no longer be changed."); session=updateDiscordSession(id,{status:"reference_selection",referenceId:null,referencePage:0}); await interaction.deferUpdate(); return interaction.editReply(await referenceScreen(session)); }
  if(action==="count") {
    if(session.status!=="slide_count") throw new Error("The slide count was already selected.");
    const count=Number(arg); await interaction.update({content:"Creating the exact-copy plan…",embeds:[],components:[]});
    const candidate:DiscordTopicCandidate={group:session.sourceContext!,label:session.topicLabel!,summary:"",reason:"",evergreen:session.evergreenReframe};
    const planned=await planDiscordContent(candidate,count); session=updateDiscordSession(id,{slideCount:count,caption:planned.caption}); const carousel=createPlannedDiscordCarousel(session,planned);
    session=updateDiscordSession(id,{status:"plan_review",carouselId:carousel.id}); return interaction.editReply(planScreen(session,carousel));
  }
  if(action==="generate") {
    if(session.status!=="plan_review") return interaction.reply({content:"Slide 1 generation was already started.",ephemeral:true});
    if(generationSession) return interaction.reply({content:"Another generation is currently running.",ephemeral:true}); generationSession=id;
    await interaction.update({content:"Generating and automatically reviewing slide 1…",embeds:[],components:[]});
    try {const result=await generateAndReviewDiscordSlide(session,1); session=updateDiscordSession(id,{status:"slide_1_review"}); return interaction.editReply(slideReviewScreen(session,result.carousel,1));}
    finally {generationSession=null;}
  }
  if(action==="approve") {
    if(!["slide_1_review","slide_review"].includes(session.status)) return interaction.reply({content:"This approval is no longer active.",ephemeral:true});
    const position=Number(arg); const attempt=getLatestDiscordAttempt(id,position); if(attempt?.review_passed!==1) return interaction.reply({content:"This slide must pass automated review before approval.",ephemeral:true});
    const carousel=approveDiscordSlide(session,position); setLatestDiscordAttemptStatus(id,position,"approved");
    if(position===1&&carousel.slides.some((slide)=>slide.position>1&&slide.status==="pending")) return generateRemaining(interaction,session);
    if(carousel.slides.every((slide)=>slide.status==="kept")) {session=updateDiscordSession(id,{status:"final_review"}); return interaction.update(finalScreen(session,carousel));}
    return interaction.update(remainingReviewScreen(session,carousel));
  }
  if(action==="review-time") { if(session.status!=="final_review") throw new Error("The carousel is not ready for scheduling."); await interaction.update({content:"Checking open Instagram slots…",embeds:[],files:[],components:[]}); const proposal=await proposeDiscordSchedule(session); session=updateDiscordSession(id,{status:"schedule_review",proposedFor:proposal.proposedFor,alternativeSlots:proposal.alternatives}); return interaction.editReply(scheduleScreen(session)); }
  if(action==="other-time") {
    if(!session.alternativeSlots.length) return interaction.reply({content:"No alternative slots are available.",ephemeral:true});
    const menu=new StringSelectMenuBuilder().setCustomId(`${PREFIX}:slot:${id}`).setPlaceholder("Choose another open time").addOptions(session.alternativeSlots.map((slot)=>({label:formatTime(slot).slice(0,100),value:slot})));
    return interaction.update({content:"Choose another open Instagram slot. The selection will return to final approval.",embeds:[],components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),row(cancelButton(id))]});
  }
  if(action==="schedule") { if(session.status!=="schedule_review") return interaction.reply({content:"This scheduling approval is no longer active.",ephemeral:true}); await interaction.update({content:"Uploading the approved carousel and scheduling Instagram…",embeds:[],components:[]}); session=await scheduleDiscordSession(session); return interaction.editReply({content:`**Instagram scheduled**\n${formatTime(session.proposedFor!)}\nZernio post: \`${session.zernioPostId||"created"}\`\nCarousel: \`${session.carouselId}\``,embeds:[],files:[],components:[]}); }
}

async function handleModal(interaction:ModalSubmitInteraction) {
  if(!allowed(interaction)) return rejectUnauthorized(interaction); claim(interaction);
  const [,action,id,arg]=interaction.customId.split(":"); if(action!=="retry-modal") return;
  let session=requireSession(id,interaction.user.id,interaction.channelId); if(!["slide_1_review","slide_review"].includes(session.status)) throw new Error("This slide review is no longer active."); const position=Number(arg); const feedback=interaction.fields.getTextInputValue("feedback").trim()||"Create a distinct alternative while preserving exact planned copy.";
  if(generationSession) return interaction.reply({content:"Another generation is currently running.",ephemeral:true}); generationSession=id; setLatestDiscordAttemptStatus(id,position,"rejected",feedback);
  await interaction.reply(`Retrying and reviewing slide ${position}…`);
  try {const result=await generateAndReviewDiscordSlide(session,position,feedback); session=updateDiscordSession(id,{status:position===1?"slide_1_review":"slide_review"}); await interaction.editReply(slideReviewScreen(session,result.carousel,position));}
  finally {generationSession=null;}
}

export async function startDiscordBot() {
  const {token,guildId,channelId,approverIds}=configuration();
  approverIds.forEach((approverId)=>getActiveDiscordSession(channelId,approverId));
  const client=new Client({intents:[GatewayIntentBits.Guilds]});
  client.once(Events.ClientReady,async(ready)=>{await registerDiscordCommands(token,ready.user.id,guildId); try{const synced=await syncDiscordGfnf();process.stdout.write(`GFNF sync: ${synced.groups} recent groups.\n`);}catch(error){console.error("Initial GFNF sync failed:",error);} setInterval(()=>void syncDiscordGfnf().catch((error)=>console.error("Hourly GFNF sync failed:",error)),60*60_000).unref(); process.stdout.write(`Discord /start ready as ${ready.user.tag}.\n`);});
  client.on(Events.InteractionCreate,async(interaction)=>{try{if(interaction.isChatInputCommand()&&interaction.commandName==="start") await handleStart(interaction); else if(interaction.isStringSelectMenu()&&interaction.customId.startsWith(`${PREFIX}:`)) await handleSelect(interaction); else if(interaction.isButton()&&interaction.customId.startsWith(`${PREFIX}:`)) await handleButton(interaction); else if(interaction.isModalSubmit()&&interaction.customId.startsWith(`${PREFIX}:`)) await handleModal(interaction);}catch(error){const message=`Workflow error: ${error instanceof Error?error.message:"Unknown error."}`;console.error(error instanceof Error?error.stack||error.message:error);if(interaction.isRepliable()&&!interaction.replied&&!interaction.deferred) await interaction.reply({content:message,ephemeral:true}).catch(()=>undefined);else if(interaction.isRepliable()) await interaction.editReply({content:message,components:[]}).catch(()=>undefined);}});
  await client.login(token); return client;
}
