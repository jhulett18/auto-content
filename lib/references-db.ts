import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  ReferenceAsset,
  ReferenceCreator,
  GenerationCollection,
  GenerationLibraryResponse,
  GenerationOutput,
  CarouselSet,
  CarouselSlide,
  ReferenceLibraryResponse,
  ReferenceMediaType,
  ReferencePlatform,
} from "./reference-types";

const DATABASE_PATH = path.join(process.cwd(), "data", "references.sqlite3");

type AssetRow = {
  id: string;
  creator_id: string;
  creator_name: string;
  creator_handle: string;
  platform: ReferencePlatform;
  media_type: ReferenceMediaType;
  thumbnail_url: string;
  media_url: string;
  post_url: string | null;
  caption: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  duration_seconds: number | null;
  selected: number;
};

let database: Database.Database | null = null;

const TEST_IMAGE_REFERENCE_ID = "4e02f4d92fab58dbac147fb74c9e06d1f8286fdc";
const TEST_VIDEO_REFERENCE_ID = "3ebb75d5500d3734241f3c12f6bbba20d1c4f662";

function ensureTestingCollection(db: Database.Database) {
  db.prepare(
    `INSERT OR IGNORE INTO generation_collections(id, label, kind, created_at)
     VALUES ('testing', 'Testing', 'analysis-showcase', ?)`,
  ).run(new Date().toISOString());
  db.prepare(
    `INSERT OR IGNORE INTO generation_items(id, collection_id, reference_id, position)
     SELECT 'testing:' || reference_id, 'testing', reference_id,
            CASE reference_id WHEN ? THEN 1 ELSE 2 END
     FROM reference_analyses
     WHERE reference_id IN (?, ?)
       AND EXISTS (SELECT 1 FROM generation_collections WHERE id = 'testing')`,
  ).run(
    TEST_IMAGE_REFERENCE_ID,
    TEST_IMAGE_REFERENCE_ID,
    TEST_VIDEO_REFERENCE_ID,
  );
}

function getDatabase() {
  if (database) return database;

  mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  database = new Database(DATABASE_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS reference_assets (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      creator_handle TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('Instagram', 'TikTok')),
      external_id TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
      thumbnail_url TEXT NOT NULL,
      media_url TEXT NOT NULL,
      post_url TEXT,
      caption TEXT,
      published_at TEXT,
      views INTEGER,
      likes INTEGER,
      duration_seconds REAL,
      selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
      captured_at TEXT NOT NULL,
      UNIQUE (platform, external_id)
    );
    CREATE INDEX IF NOT EXISTS reference_assets_creator_idx
      ON reference_assets (creator_id, published_at DESC);
    CREATE INDEX IF NOT EXISTS reference_assets_selected_idx
      ON reference_assets (selected);
    CREATE TABLE IF NOT EXISTS reference_analyses (
      reference_id TEXT PRIMARY KEY REFERENCES reference_assets(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL,
      model TEXT NOT NULL,
      frame_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_collections (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('analysis-showcase')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES generation_collections(id) ON DELETE CASCADE,
      reference_id TEXT NOT NULL REFERENCES reference_assets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      UNIQUE (collection_id, reference_id)
    );
    CREATE INDEX IF NOT EXISTS generation_items_collection_idx
      ON generation_items (collection_id, position);
    CREATE TABLE IF NOT EXISTS generation_outputs (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES generation_collections(id) ON DELETE CASCADE,
      reference_id TEXT NOT NULL REFERENCES reference_assets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL UNIQUE,
      model TEXT NOT NULL,
      topic_style_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generation_outputs_collection_idx
      ON generation_outputs (collection_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS carousel_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      anchor_reference_id TEXT NOT NULL REFERENCES reference_assets(id),
      topic_style_id TEXT NOT NULL,
      slide_count INTEGER NOT NULL CHECK (slide_count BETWEEN 3 AND 10),
      subject TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS carousel_slides (
      id TEXT PRIMARY KEY,
      carousel_id TEXT NOT NULL REFERENCES carousel_sets(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','generating','generated','kept','failed')),
      instruction TEXT,
      file_name TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (carousel_id, position)
    );
    CREATE INDEX IF NOT EXISTS carousel_slides_carousel_idx
      ON carousel_slides (carousel_id, position);
  `);
  database.prepare(
    `UPDATE reference_assets
     SET media_type = 'image', media_url = thumbnail_url
     WHERE id = ? AND media_type = 'video'`,
  ).run("e5a2ed900c3f6133f8c6361c1fe5972f66f90342");
  ensureTestingCollection(database);
  return database;
}

function publicMediaPath(id: string, kind: "thumbnail" | "media") {
  return `/api/references/${encodeURIComponent(id)}/media?kind=${kind}`;
}

function toAsset(row: AssetRow): ReferenceAsset {
  return {
    id: row.id,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    creatorHandle: row.creator_handle,
    platform: row.platform,
    mediaType: row.media_type,
    thumbnailUrl: publicMediaPath(row.id, "thumbnail"),
    mediaUrl: publicMediaPath(row.id, "media"),
    postUrl: row.post_url,
    caption: row.caption,
    publishedAt: row.published_at,
    views: row.views,
    likes: row.likes,
    durationSeconds: row.duration_seconds,
    selected: Boolean(row.selected),
  };
}

export function listReferenceLibrary(): ReferenceLibraryResponse {
  const rows = getDatabase()
    .prepare(
      `SELECT id, creator_id, creator_name, creator_handle, platform,
              media_type, thumbnail_url, media_url, post_url, caption,
              published_at, views, likes, duration_seconds, selected
       FROM reference_assets
       ORDER BY creator_name COLLATE NOCASE, published_at DESC, id`,
    )
    .all() as AssetRow[];

  const creators = new Map<string, ReferenceCreator>();
  for (const row of rows) {
    const asset = toAsset(row);
    const creator = creators.get(row.creator_id) ?? {
      id: row.creator_id,
      name: row.creator_name,
      handle: row.creator_handle,
      assets: [],
    };
    creator.assets.push(asset);
    creators.set(row.creator_id, creator);
  }

  return {
    creators: [...creators.values()],
    totalAssets: rows.length,
    selectedIds: rows.filter((row) => row.selected).map((row) => row.id),
  };
}

export function setSelectedReferences(ids: string[]) {
  if (ids.length > 1 || new Set(ids).size !== ids.length) {
    throw new Error("Choose one unique image reference.");
  }

  const db = getDatabase();
  const placeholders = ids.map(() => "?").join(",");
  if (ids.length) {
    const existing = db
      .prepare(`SELECT id FROM reference_assets WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: string }>;
    if (existing.length !== ids.length) throw new Error("A reference was not found.");
    const media = db.prepare(`SELECT media_type FROM reference_assets WHERE id = ?`).get(ids[0]) as { media_type: ReferenceMediaType } | undefined;
    if (media?.media_type !== "image") throw new Error("Carousel anchors must be image references.");
  }

  db.transaction(() => {
    db.prepare("UPDATE reference_assets SET selected = 0").run();
    if (ids.length) {
      db.prepare(
        `UPDATE reference_assets SET selected = 1 WHERE id IN (${placeholders})`,
      ).run(...ids);
    }
  })();

  return listReferenceLibrary();
}

export function getReferenceMedia(id: string) {
  return getDatabase()
    .prepare(
      `SELECT id, media_type, thumbnail_url, media_url
       FROM reference_assets WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        media_type: ReferenceMediaType;
        thumbnail_url: string;
        media_url: string;
      }
    | undefined;
}

export type ReferenceAnalysisSource = {
  id: string;
  creatorName: string;
  creatorHandle: string;
  platform: ReferencePlatform;
  mediaType: ReferenceMediaType;
  mediaUrl: string;
  thumbnailUrl: string;
  caption: string | null;
};

export function getReferenceAnalysisSource(
  id: string,
): ReferenceAnalysisSource | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, creator_name, creator_handle, platform, media_type,
              media_url, thumbnail_url, caption
       FROM reference_assets WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        creator_name: string;
        creator_handle: string;
        platform: ReferencePlatform;
        media_type: ReferenceMediaType;
        media_url: string;
        thumbnail_url: string;
        caption: string | null;
      }
    | undefined;

  if (!row) return undefined;
  return {
    id: row.id,
    creatorName: row.creator_name,
    creatorHandle: row.creator_handle,
    platform: row.platform,
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    thumbnailUrl: row.thumbnail_url,
    caption: row.caption,
  };
}

export function getStoredReferenceAnalysis(id: string) {
  return getDatabase()
    .prepare(
      `SELECT reference_id, media_type, model, frame_count, duration_ms,
              result_json, created_at
       FROM reference_analyses WHERE reference_id = ?`,
    )
    .get(id) as
    | {
        reference_id: string;
        media_type: ReferenceMediaType;
        model: string;
        frame_count: number;
        duration_ms: number;
        result_json: string;
        created_at: string;
      }
    | undefined;
}

export function saveReferenceAnalysis(input: {
  referenceId: string;
  mediaType: ReferenceMediaType;
  model: string;
  frameCount: number;
  durationMs: number;
  resultJson: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO reference_analyses(
         reference_id, media_type, model, frame_count, duration_ms,
         result_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(reference_id) DO UPDATE SET
         media_type = excluded.media_type,
         model = excluded.model,
         frame_count = excluded.frame_count,
         duration_ms = excluded.duration_ms,
         result_json = excluded.result_json,
         created_at = excluded.created_at`,
    )
    .run(
      input.referenceId,
      input.mediaType,
      input.model,
      input.frameCount,
      input.durationMs,
      input.resultJson,
      new Date().toISOString(),
    );
}

export function listGenerationLibrary(): GenerationLibraryResponse {
  const db = getDatabase();
  ensureTestingCollection(db);
  const collections = db
    .prepare(
      `SELECT id, label, kind, created_at
       FROM generation_collections
       ORDER BY created_at DESC, id`,
    )
    .all() as Array<{
      id: string;
      label: string;
      kind: GenerationCollection["kind"];
      created_at: string;
    }>;

  const itemStatement = db.prepare(
    `SELECT gi.id, gi.reference_id, ra.creator_name, ra.creator_handle,
            ra.platform, ra.media_type, ran.model, ran.frame_count,
            ran.duration_ms, ran.result_json
     FROM generation_items gi
     JOIN reference_assets ra ON ra.id = gi.reference_id
     JOIN reference_analyses ran ON ran.reference_id = gi.reference_id
     WHERE gi.collection_id = ?
     ORDER BY gi.position, gi.id`,
  );

  const outputStatement = db.prepare(
    `SELECT go.id, go.reference_id, go.title, ra.creator_name,
            ra.creator_handle, ra.platform, ra.caption, ra.post_url,
            go.model, go.topic_style_id,
            go.created_at
     FROM generation_outputs go
     JOIN reference_assets ra ON ra.id = go.reference_id
     WHERE go.collection_id = ?
     ORDER BY go.created_at DESC, go.id`,
  );

  const result = collections.map((collection) => {
    const rows = itemStatement.all(collection.id) as Array<{
      id: string;
      reference_id: string;
      creator_name: string;
      creator_handle: string;
      platform: ReferencePlatform;
      media_type: ReferenceMediaType;
      model: string;
      frame_count: number;
      duration_ms: number;
      result_json: string;
    }>;

    const outputRows = outputStatement.all(collection.id) as Array<{
      id: string;
      reference_id: string;
      title: string;
      creator_name: string;
      creator_handle: string;
      platform: ReferencePlatform;
      caption: string | null;
      post_url: string | null;
      model: string;
      topic_style_id: string;
      created_at: string;
    }>;

    return {
      id: collection.id,
      label: collection.label,
      kind: collection.kind,
      createdAt: collection.created_at,
      items: rows.map((row) => ({
        id: row.id,
        referenceId: row.reference_id,
        title:
          row.media_type === "video"
            ? "Video reference analysis"
            : "Image reference analysis",
        creatorName: row.creator_name,
        creatorHandle: row.creator_handle,
        platform: row.platform,
        mediaType: row.media_type,
        thumbnailUrl: publicMediaPath(row.reference_id, "thumbnail"),
        mediaUrl: publicMediaPath(row.reference_id, "media"),
        model: row.model,
        frameCount: row.frame_count,
        durationMs: row.duration_ms,
        analysis: JSON.parse(row.result_json),
      })),
      outputs: outputRows.map((row) => ({
        id: row.id,
        title: row.title,
        referenceId: row.reference_id,
        creatorName: row.creator_name,
        creatorHandle: row.creator_handle,
        platform: row.platform,
        imageUrl: `/api/generations/${encodeURIComponent(row.id)}/image`,
        sourceThumbnailUrl: publicMediaPath(row.reference_id, "thumbnail"),
        sourceCaption: row.caption,
        sourcePostUrl: row.post_url,
        model: row.model,
        topicStyleId: row.topic_style_id,
        createdAt: row.created_at,
      } satisfies GenerationOutput)),
    } satisfies GenerationCollection;
  });

  return {
    collections: result,
    totalItems: result.reduce(
      (total, collection) => total + collection.items.length + collection.outputs.length,
      0,
    ),
  };
}

export function saveGenerationOutput(input: {
  id: string;
  referenceId: string;
  title: string;
  fileName: string;
  model: string;
  topicStyleId: string;
}) {
  const db = getDatabase();
  ensureTestingCollection(db);
  db.prepare(
    `INSERT INTO generation_outputs(
       id, collection_id, reference_id, title, file_name,
       model, topic_style_id, created_at
     ) VALUES (?, 'testing', ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.referenceId,
    input.title,
    input.fileName,
    input.model,
    input.topicStyleId,
    new Date().toISOString(),
  );
}

export function getGenerationOutput(id: string) {
  return getDatabase()
    .prepare(
      `SELECT id, file_name FROM generation_outputs WHERE id = ?`,
    )
    .get(id) as { id: string; file_name: string } | undefined;
}

function carouselSlide(row: {
  id: string; carousel_id: string; position: number; status: CarouselSlide["status"];
  instruction: string | null; file_name: string | null; error: string | null; created_at: string;
}): CarouselSlide {
  return {
    id: row.id,
    carouselId: row.carousel_id,
    position: row.position,
    status: row.status,
    instruction: row.instruction,
    imageUrl: row.file_name ? `/api/carousels/${encodeURIComponent(row.carousel_id)}/slides/${row.position}/image` : null,
    error: row.error,
    createdAt: row.created_at,
  };
}

export function createCarouselSet(input: { name: string; anchorReferenceId: string; topicStyleId: string; slideCount: number; subject: string }) {
  if (input.slideCount < 3 || input.slideCount > 10) throw new Error("Slide count must be between 3 and 10.");
  const db = getDatabase();
  const anchor = db.prepare(`SELECT id, media_type FROM reference_assets WHERE id = ?`).get(input.anchorReferenceId) as { id: string; media_type: ReferenceMediaType } | undefined;
  if (!anchor) throw new Error("Anchor reference was not found.");
  if (anchor.media_type !== "image") throw new Error("Carousel anchors must be image references.");
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO carousel_sets(id,name,anchor_reference_id,topic_style_id,slide_count,subject,status,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, input.name.trim() || "Untitled carousel", input.anchorReferenceId, input.topicStyleId, input.slideCount, input.subject.trim() || "Original visual story", "in_progress", createdAt);
    const statement = db.prepare(`INSERT INTO carousel_slides(id,carousel_id,position,status,instruction,created_at) VALUES (?,?,?,?,?,?)`);
    for (let position = 1; position <= input.slideCount; position += 1) statement.run(randomUUID(), id, position, "pending", null, createdAt);
  })();
  return getCarouselSet(id)!;
}

export function getCarouselSet(id: string): CarouselSet | undefined {
  const db = getDatabase();
  const row = db.prepare(`SELECT id,name,anchor_reference_id,topic_style_id,slide_count,subject,status,created_at FROM carousel_sets WHERE id = ?`).get(id) as { id:string; name:string; anchor_reference_id:string; topic_style_id:string; slide_count:number; subject:string; status:CarouselSet["status"]; created_at:string } | undefined;
  if (!row) return undefined;
  const slides = db.prepare(`SELECT id,carousel_id,position,status,instruction,file_name,error,created_at FROM carousel_slides WHERE carousel_id = ? ORDER BY position`).all(id) as Array<{id:string;carousel_id:string;position:number;status:CarouselSlide["status"];instruction:string|null;file_name:string|null;error:string|null;created_at:string}>;
  return { id: row.id, name: row.name, anchorReferenceId: row.anchor_reference_id, topicStyleId: row.topic_style_id, slideCount: row.slide_count, subject: row.subject, status: row.status, slides: slides.map(carouselSlide), createdAt: row.created_at };
}

export function updateCarouselSlide(input: { carouselId: string; position: number; status: CarouselSlide["status"]; instruction?: string | null; fileName?: string | null; error?: string | null }) {
  const db = getDatabase();
  db.prepare(`UPDATE carousel_slides SET status = ?, instruction = COALESCE(?, instruction), file_name = ?, error = ? WHERE carousel_id = ? AND position = ?`).run(input.status, input.instruction ?? null, input.fileName ?? null, input.error ?? null, input.carouselId, input.position);
  if (input.status === "kept") {
    const pending = db.prepare(`SELECT COUNT(*) AS count FROM carousel_slides WHERE carousel_id = ? AND status != 'kept'`).get(input.carouselId) as { count: number };
    if (pending.count === 0) db.prepare(`UPDATE carousel_sets SET status = 'completed' WHERE id = ?`).run(input.carouselId);
  }
  return getCarouselSet(input.carouselId);
}

export function getCarouselSlideFile(carouselId: string, position: number) {
  return getDatabase().prepare(`SELECT file_name FROM carousel_slides WHERE carousel_id = ? AND position = ?`).get(carouselId, position) as { file_name: string | null } | undefined;
}

export function listCarouselSets() {
  const db = getDatabase();
  const rows = db.prepare(`SELECT id FROM carousel_sets ORDER BY created_at DESC`).all() as Array<{id:string}>;
  return rows.flatMap((row) => { const set = getCarouselSet(row.id); return set ? [set] : []; });
}
