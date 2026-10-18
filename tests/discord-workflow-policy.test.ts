import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateDiscordTopics, discordReferencePostUrl, discordReferenceTitle, evergreenDiscordTopicLabel, paginateDiscordReferences, shouldEvergreenReframe } from "../lib/discord-workflow-policy.ts";

test("reframes prior-day GFNF topics without treating same-day topics as stale", () => {
  const now=new Date("2026-10-16T15:00:00.000Z");
  assert.equal(shouldEvergreenReframe("2026-10-16T13:00:00.000Z",now,"America/New_York"),false);
  assert.equal(shouldEvergreenReframe("2026-10-15T23:00:00.000Z",now,"America/New_York"),true);
  assert.equal(evergreenDiscordTopicLabel("Target stock drops tonight"),"How to prepare for a retail restock");
  assert.equal(evergreenDiscordTopicLabel("A retailer raffle opens"),"How to prepare for a retailer draw");
});

test("reference browser uses stable five-item pages and clamps page bounds", () => {
  const references=Array.from({length:31},(_,index)=>index+1);
  assert.deepEqual(paginateDiscordReferences(references,0).items,[1,2,3,4,5]);
  assert.deepEqual(paginateDiscordReferences(references,6),{page:6,pages:7,items:[31]});
  assert.equal(paginateDiscordReferences(references,99).page,6);
  assert.equal(paginateDiscordReferences(references,-4).page,0);
});

test("topic choices keep the highest-ranked instance of each visible label", () => {
  const topics=[
    {label:"How to prepare for a retail restock",key:"newer"},
    {label:"  HOW TO PREPARE FOR A RETAIL RESTOCK  ",key:"older"},
    {label:"How to prepare for a retailer draw",key:"draw"},
  ];
  assert.deepEqual(deduplicateDiscordTopics(topics).map((topic)=>topic.key),["newer","draw"]);
});

test("reference choices show a title derived from saved name, caption, or source", () => {
  assert.equal(discordReferenceTitle({savedName:"Bold grid",caption:"Ignored caption",creatorHandle:"source",platform:"Instagram"}),"Bold grid");
  assert.equal(discordReferenceTitle({savedName:null,caption:"  First line\nwith spacing  ",creatorHandle:"source",platform:"Instagram"}),"First line with spacing");
  assert.equal(discordReferenceTitle({savedName:null,caption:null,creatorHandle:"source",platform:"TikTok"}),"@source · TikTok");
});

test("reference choices link only to valid HTTPS source posts", () => {
  assert.equal(discordReferencePostUrl({postUrl:"https://www.instagram.com/p/example/"}),"https://www.instagram.com/p/example/");
  assert.equal(discordReferencePostUrl({postUrl:"javascript:alert(1)"}),null);
  assert.equal(discordReferencePostUrl({postUrl:"not a url"}),null);
});
