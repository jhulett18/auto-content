import { randomUUID } from "node:crypto";
import type { DailyCandidateSignals, DailyWorkflowRun, DailyWorkflowVariation, DraftContextGroup } from "./reference-types";
import { getDatabase } from "./references-db";
import { messageFingerprint } from "./daily-keywords";

function ensureAutomationSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_messages (
      fingerprint TEXT PRIMARY KEY,
      context_key TEXT NOT NULL,
      author TEXT NOT NULL,
      message_timestamp TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      products_json TEXT NOT NULL,
      signals_json TEXT,
      eligible INTEGER NOT NULL DEFAULT 0 CHECK (eligible IN (0,1)),
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS automation_messages_timestamp_idx ON automation_messages(message_timestamp DESC);
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      run_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('collecting','generating','awaiting_approval','approved','scheduled','failed','no_candidate','rejected')),
      candidate_key TEXT,
      candidate_text TEXT,
      candidate_timestamp TEXT,
      signals_json TEXT,
      reference_id TEXT REFERENCES reference_assets(id),
      reference_name TEXT,
      caption TEXT,
      scheduled_for TEXT,
      approved_variation TEXT CHECK (approved_variation IN ('A','B')),
      telegram_message_id INTEGER,
      discord_message_id TEXT,
      zernio_post_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_variations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
      label TEXT NOT NULL CHECK (label IN ('A','B')),
      carousel_id TEXT NOT NULL REFERENCES carousel_sets(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','generating','ready','failed','approved','rejected')),
      review_status TEXT NOT NULL CHECK (review_status IN ('pending','passed','failed')),
      review_notes_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      UNIQUE(run_id,label)
    );
    CREATE TABLE IF NOT EXISTS automation_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_leases (
      name TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  try { db.exec("ALTER TABLE automation_runs ADD COLUMN discord_message_id TEXT"); } catch { /* existing schema already migrated */ }
  return db;
}

export function acquireAutomationLease(name: string, durationMs = 30 * 60_000) {
  const db = ensureAutomationSchema();
  const holder = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs).toISOString();
  return db.transaction(() => {
    db.prepare(`DELETE FROM automation_leases WHERE name = ? AND expires_at <= ?`).run(name, now.toISOString());
    const result = db.prepare(`INSERT OR IGNORE INTO automation_leases(name,holder,expires_at) VALUES (?,?,?)`).run(name, holder, expiresAt);
    return result.changes === 1 ? holder : null;
  })();
}

export function releaseAutomationLease(name: string, holder: string) {
  ensureAutomationSchema().prepare(`DELETE FROM automation_leases WHERE name = ? AND holder = ?`).run(name, holder);
}

export function persistAutomationGroups(groups: DraftContextGroup[], signalFor: (group: DraftContextGroup) => DailyCandidateSignals, qualifies: (signals: DailyCandidateSignals) => boolean) {
  const db = ensureAutomationSchema();
  const statement = db.prepare(`INSERT INTO automation_messages(fingerprint,context_key,author,message_timestamp,text,attachments_json,products_json,signals_json,eligible,imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET context_key=excluded.context_key, attachments_json=excluded.attachments_json, products_json=excluded.products_json, signals_json=excluded.signals_json, eligible=excluded.eligible`);
  const importedAt = new Date().toISOString();
  return db.transaction(() => groups.reduce((count, group) => {
    const signals = signalFor(group);
    const result = statement.run(messageFingerprint({ timestamp: group.timestamp, author: group.author, text: group.text }), group.key, group.author, group.timestamp, group.text, JSON.stringify(group.attachments), JSON.stringify(group.products), JSON.stringify(signals), qualifies(signals) ? 1 : 0, importedAt);
    return count + result.changes;
  }, 0))();
}

export function getOrCreateAutomationRun(runDate: string) {
  const db = ensureAutomationSchema();
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO automation_runs(id,run_date,status,created_at,updated_at) VALUES (?,?, 'collecting',?,?)`).run(randomUUID(), runDate, now, now);
  return getAutomationRunByDate(runDate)!;
}

export function getAutomationRunByDate(runDate: string) {
  const row = ensureAutomationSchema().prepare(`SELECT * FROM automation_runs WHERE run_date = ?`).get(runDate) as RunRow | undefined;
  return row ? hydrateRun(row) : undefined;
}

export function getAutomationRun(id: string) {
  const row = ensureAutomationSchema().prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(id) as RunRow | undefined;
  return row ? hydrateRun(row) : undefined;
}

export function getPendingAutomationRun() {
  const row = ensureAutomationSchema().prepare(`SELECT * FROM automation_runs WHERE status IN ('awaiting_approval','approved') ORDER BY created_at LIMIT 1`).get() as RunRow | undefined;
  return row ? hydrateRun(row) : undefined;
}

type RunRow = {
  id:string; run_date:string; status:DailyWorkflowRun["status"]; candidate_key:string|null; candidate_text:string|null; candidate_timestamp:string|null;
  signals_json:string|null; reference_id:string|null; reference_name:string|null; caption:string|null; scheduled_for:string|null;
  approved_variation:"A"|"B"|null; telegram_message_id:number|null; discord_message_id:string|null; zernio_post_id:string|null; error:string|null; created_at:string; updated_at:string;
};

function hydrateRun(row: RunRow): DailyWorkflowRun {
  const variations = ensureAutomationSchema().prepare(`SELECT id,label,carousel_id,status,review_status,review_notes_json,error FROM automation_variations WHERE run_id = ? ORDER BY label`).all(row.id) as Array<{id:string;label:"A"|"B";carousel_id:string;status:DailyWorkflowVariation["status"];review_status:DailyWorkflowVariation["reviewStatus"];review_notes_json:string;error:string|null}>;
  return {
    id: row.id, runDate: row.run_date, status: row.status, candidateKey: row.candidate_key, candidateText: row.candidate_text,
    candidateTimestamp: row.candidate_timestamp, signals: row.signals_json ? JSON.parse(row.signals_json) as DailyCandidateSignals : null,
    referenceId: row.reference_id, referenceName: row.reference_name, caption: row.caption, scheduledFor: row.scheduled_for,
    approvedVariation: row.approved_variation, telegramMessageId: row.telegram_message_id, discordMessageId: row.discord_message_id, zernioPostId: row.zernio_post_id,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
    variations: variations.map((variation) => ({ id: variation.id, label: variation.label, carouselId: variation.carousel_id, status: variation.status, reviewStatus: variation.review_status, reviewNotes: JSON.parse(variation.review_notes_json) as string[], error: variation.error })),
  };
}

export function updateAutomationRun(id: string, input: Partial<{status:DailyWorkflowRun["status"];candidateKey:string|null;candidateText:string|null;candidateTimestamp:string|null;signals:DailyCandidateSignals|null;referenceId:string|null;referenceName:string|null;caption:string|null;scheduledFor:string|null;approvedVariation:"A"|"B"|null;telegramMessageId:number|null;discordMessageId:string|null;zernioPostId:string|null;error:string|null}>) {
  const columns: Record<string,string> = { status:"status", candidateKey:"candidate_key", candidateText:"candidate_text", candidateTimestamp:"candidate_timestamp", signals:"signals_json", referenceId:"reference_id", referenceName:"reference_name", caption:"caption", scheduledFor:"scheduled_for", approvedVariation:"approved_variation", telegramMessageId:"telegram_message_id", discordMessageId:"discord_message_id", zernioPostId:"zernio_post_id", error:"error" };
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in input)) continue;
    assignments.push(`${column} = ?`);
    const value = input[key as keyof typeof input];
    values.push(key === "signals" && value ? JSON.stringify(value) : value);
  }
  assignments.push("updated_at = ?"); values.push(new Date().toISOString(), id);
  ensureAutomationSchema().prepare(`UPDATE automation_runs SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
  return getAutomationRun(id)!;
}

export function saveAutomationVariation(runId: string, label: "A" | "B", carouselId: string) {
  ensureAutomationSchema().prepare(`INSERT INTO automation_variations(id,run_id,label,carousel_id,status,review_status) VALUES (?,?,?,?, 'pending','pending')
    ON CONFLICT(run_id,label) DO UPDATE SET carousel_id=excluded.carousel_id,status='pending',review_status='pending',review_notes_json='[]',error=NULL`).run(randomUUID(), runId, label, carouselId);
  return getAutomationRun(runId)!;
}

export function updateAutomationVariation(runId: string, label: "A" | "B", input: Partial<{status:DailyWorkflowVariation["status"];reviewStatus:DailyWorkflowVariation["reviewStatus"];reviewNotes:string[];error:string|null}>) {
  ensureAutomationSchema().prepare(`UPDATE automation_variations SET status=COALESCE(?,status), review_status=COALESCE(?,review_status), review_notes_json=COALESCE(?,review_notes_json), error=? WHERE run_id=? AND label=?`)
    .run(input.status ?? null, input.reviewStatus ?? null, input.reviewNotes ? JSON.stringify(input.reviewNotes) : null, input.error ?? null, runId, label);
  return getAutomationRun(runId)!;
}

export function getAutomationMeta(key: string) {
  return (ensureAutomationSchema().prepare(`SELECT value FROM automation_meta WHERE key = ?`).get(key) as {value:string}|undefined)?.value ?? null;
}

export function setAutomationMeta(key: string, value: string) {
  ensureAutomationSchema().prepare(`INSERT INTO automation_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

export function listAutomationRuns(limit = 30) {
  const rows = ensureAutomationSchema().prepare(`SELECT * FROM automation_runs ORDER BY run_date DESC LIMIT ?`).all(limit) as RunRow[];
  return rows.map(hydrateRun);
}

export function getAutomationContext(contextKey: string): DraftContextGroup | undefined {
  const row = ensureAutomationSchema().prepare(`SELECT context_key,author,message_timestamp,text,attachments_json,products_json FROM automation_messages WHERE context_key = ? ORDER BY message_timestamp DESC LIMIT 1`).get(contextKey) as {context_key:string;author:string;message_timestamp:string;text:string;attachments_json:string;products_json:string}|undefined;
  return row ? { key: row.context_key, author: row.author, timestamp: row.message_timestamp, text: row.text, attachments: JSON.parse(row.attachments_json), products: JSON.parse(row.products_json) } as DraftContextGroup : undefined;
}

export function listRecentAutomationContexts(sinceIso: string) {
  const rows = ensureAutomationSchema().prepare(`SELECT context_key,author,message_timestamp,text,attachments_json,products_json,signals_json,eligible FROM automation_messages WHERE message_timestamp >= ? ORDER BY message_timestamp DESC`).all(sinceIso) as Array<{context_key:string;author:string;message_timestamp:string;text:string;attachments_json:string;products_json:string;signals_json:string|null;eligible:number}>;
  return rows.map((row) => ({
    group: { key:row.context_key,author:row.author,timestamp:row.message_timestamp,text:row.text,attachments:JSON.parse(row.attachments_json),products:JSON.parse(row.products_json) } as DraftContextGroup,
    signals: row.signals_json ? JSON.parse(row.signals_json) as DailyCandidateSignals : null,
    eligible: Boolean(row.eligible),
  }));
}
