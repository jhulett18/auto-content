import { randomUUID } from "node:crypto";
import { getDatabase } from "./references-db";
import type { CarouselPlan, DraftContextGroup } from "./reference-types";

export type DiscordWorkflowStatus =
  | "topic_selection" | "reference_selection" | "slide_count" | "plan_review"
  | "slide_1_review" | "remaining_generation" | "slide_review" | "final_review"
  | "schedule_review" | "saved" | "scheduled" | "cancelled" | "failed";

export type DiscordContentSession = {
  id: string;
  channelId: string;
  userId: string;
  status: DiscordWorkflowStatus;
  resumeStatus: DiscordWorkflowStatus | null;
  sourceContextKey: string | null;
  sourceContext: DraftContextGroup | null;
  topicLabel: string | null;
  evergreenReframe: boolean;
  referenceId: string | null;
  referencePage: number;
  slideCount: number | null;
  carouselId: string | null;
  caption: string | null;
  proposedFor: string | null;
  alternativeSlots: string[];
  zernioPostId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function ensureSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_content_sessions (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      resume_status TEXT,
      source_context_key TEXT,
      source_context_json TEXT,
      topic_label TEXT,
      evergreen_reframe INTEGER NOT NULL DEFAULT 0 CHECK (evergreen_reframe IN (0,1)),
      reference_id TEXT REFERENCES reference_assets(id),
      reference_page INTEGER NOT NULL DEFAULT 0,
      slide_count INTEGER,
      carousel_id TEXT REFERENCES carousel_sets(id),
      caption TEXT,
      proposed_for TEXT,
      alternative_slots_json TEXT NOT NULL DEFAULT '[]',
      zernio_post_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discord_content_sessions_active_idx
      ON discord_content_sessions(channel_id,user_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS discord_slide_attempts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES discord_content_sessions(id) ON DELETE CASCADE,
      carousel_id TEXT NOT NULL REFERENCES carousel_sets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      file_name TEXT,
      status TEXT NOT NULL CHECK (status IN ('generated','review_failed','approved','rejected','failed')),
      feedback TEXT,
      review_passed INTEGER,
      review_notes_json TEXT NOT NULL DEFAULT '[]',
      cost_usd REAL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discord_slide_attempts_session_idx
      ON discord_slide_attempts(session_id,position,created_at DESC);
    CREATE TABLE IF NOT EXISTS discord_processed_interactions (
      interaction_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  const sessionColumns=db.prepare(`PRAGMA table_info(discord_content_sessions)`).all() as Array<{name:string}>;
  if (!sessionColumns.some((column)=>column.name==="resume_status")) db.exec(`ALTER TABLE discord_content_sessions ADD COLUMN resume_status TEXT`);
  return db;
}

type SessionRow = {
  id:string; channel_id:string; user_id:string; status:DiscordWorkflowStatus; resume_status:DiscordWorkflowStatus|null; source_context_key:string|null;
  source_context_json:string|null; topic_label:string|null; evergreen_reframe:number; reference_id:string|null;
  reference_page:number; slide_count:number|null; carousel_id:string|null; caption:string|null; proposed_for:string|null;
  alternative_slots_json:string; zernio_post_id:string|null; error:string|null; created_at:string; updated_at:string;
};

function hydrate(row: SessionRow): DiscordContentSession {
  return {
    id:row.id, channelId:row.channel_id, userId:row.user_id, status:row.status, resumeStatus:row.resume_status,
    sourceContextKey:row.source_context_key,
    sourceContext:row.source_context_json ? JSON.parse(row.source_context_json) as DraftContextGroup : null,
    topicLabel:row.topic_label, evergreenReframe:Boolean(row.evergreen_reframe), referenceId:row.reference_id,
    referencePage:row.reference_page, slideCount:row.slide_count, carouselId:row.carousel_id, caption:row.caption,
    proposedFor:row.proposed_for, alternativeSlots:JSON.parse(row.alternative_slots_json) as string[],
    zernioPostId:row.zernio_post_id, error:row.error, createdAt:row.created_at, updatedAt:row.updated_at,
  };
}

export function createDiscordSession(channelId: string, userId: string) {
  const db = ensureSchema();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO discord_content_sessions(id,channel_id,user_id,status,created_at,updated_at) VALUES (?,?,?,'topic_selection',?,?)`)
    .run(id, channelId, userId, now, now);
  return getDiscordSession(id)!;
}

export function getDiscordSession(id: string) {
  const row = ensureSchema().prepare(`SELECT * FROM discord_content_sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function getActiveDiscordSession(channelId: string, userId: string) {
  const row = ensureSchema().prepare(`SELECT * FROM discord_content_sessions WHERE channel_id=? AND user_id=? AND status NOT IN ('saved','scheduled','cancelled','failed') ORDER BY updated_at DESC LIMIT 1`).get(channelId,userId) as SessionRow|undefined;
  return row ? hydrate(row) : undefined;
}

export function listSavedDiscordSessions(channelId:string,userId:string,limit=25) {
  const rows=ensureSchema().prepare(`SELECT * FROM discord_content_sessions WHERE channel_id=? AND user_id=? AND status='saved' ORDER BY updated_at DESC LIMIT ?`).all(channelId,userId,limit) as SessionRow[];
  return rows.map(hydrate);
}

export function updateDiscordSession(id: string, input: Partial<{
  status:DiscordWorkflowStatus; resumeStatus:DiscordWorkflowStatus|null; sourceContextKey:string|null; sourceContext:DraftContextGroup|null; topicLabel:string|null;
  evergreenReframe:boolean; referenceId:string|null; referencePage:number; slideCount:number|null; carouselId:string|null;
  caption:string|null; proposedFor:string|null; alternativeSlots:string[]; zernioPostId:string|null; error:string|null;
}>) {
  const columns: Record<string,string> = { status:"status",resumeStatus:"resume_status",sourceContextKey:"source_context_key",sourceContext:"source_context_json",topicLabel:"topic_label",evergreenReframe:"evergreen_reframe",referenceId:"reference_id",referencePage:"reference_page",slideCount:"slide_count",carouselId:"carousel_id",caption:"caption",proposedFor:"proposed_for",alternativeSlots:"alternative_slots_json",zernioPostId:"zernio_post_id",error:"error" };
  const assignments:string[]=[]; const values:unknown[]=[];
  for (const [key,column] of Object.entries(columns)) {
    if (!(key in input)) continue;
    assignments.push(`${column}=?`);
    const value=input[key as keyof typeof input];
    values.push(key === "sourceContext" && value ? JSON.stringify(value) : key === "alternativeSlots" ? JSON.stringify(value ?? []) : key === "evergreenReframe" ? (value ? 1 : 0) : value);
  }
  assignments.push("updated_at=?"); values.push(new Date().toISOString(),id);
  ensureSchema().prepare(`UPDATE discord_content_sessions SET ${assignments.join(",")} WHERE id=?`).run(...values);
  return getDiscordSession(id)!;
}

export function claimDiscordInteraction(interactionId: string) {
  const result = ensureSchema().prepare(`INSERT OR IGNORE INTO discord_processed_interactions(interaction_id,created_at) VALUES (?,?)`).run(interactionId,new Date().toISOString());
  return result.changes === 1;
}

export function recordDiscordSlideAttempt(input:{sessionId:string;carouselId:string;position:number;fileName:string|null;status:"generated"|"review_failed"|"approved"|"rejected"|"failed";feedback?:string|null;reviewPassed?:boolean|null;reviewNotes?:string[];costUsd?:number|null}) {
  ensureSchema().prepare(`INSERT INTO discord_slide_attempts(id,session_id,carousel_id,position,file_name,status,feedback,review_passed,review_notes_json,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(),input.sessionId,input.carouselId,input.position,input.fileName,input.status,input.feedback??null,input.reviewPassed == null ? null : input.reviewPassed ? 1 : 0,JSON.stringify(input.reviewNotes??[]),input.costUsd??null,new Date().toISOString());
}

export function setLatestDiscordAttemptStatus(sessionId:string, position:number, status:"approved"|"rejected", feedback?:string|null) {
  ensureSchema().prepare(`UPDATE discord_slide_attempts SET status=?,feedback=COALESCE(?,feedback) WHERE id=(SELECT id FROM discord_slide_attempts WHERE session_id=? AND position=? ORDER BY created_at DESC LIMIT 1)`).run(status,feedback??null,sessionId,position);
}

export function getLatestDiscordAttempt(sessionId:string, position:number) {
  return ensureSchema().prepare(`SELECT id,status,feedback,review_passed,review_notes_json,cost_usd,created_at FROM discord_slide_attempts WHERE session_id=? AND position=? ORDER BY created_at DESC LIMIT 1`).get(sessionId,position) as {id:string;status:string;feedback:string|null;review_passed:number|null;review_notes_json:string;cost_usd:number|null;created_at:string}|undefined;
}

export type PlannedDiscordContent = { plan:CarouselPlan; caption:string; title:string; subject:string; topicStyleId:string };
