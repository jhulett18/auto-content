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
  GenerationBudget,
  ImageGenerationUsage,
  CarouselSet,
  CarouselSlide,
  CarouselPlan,
  CarouselProductAsset,
  CarouselVisualSystem,
  DraftContextGroup,
  ProductAssetStatus,
  ProductMaskRegion,
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
  saved: number;
  saved_name: string | null;
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

export function getDatabase() {
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
      target_brand TEXT NOT NULL DEFAULT 'Locked-In Supply',
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
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const carouselColumns = database.prepare(`PRAGMA table_info(carousel_sets)`).all() as Array<{ name: string }>;
  if (!carouselColumns.some((column) => column.name === "target_brand")) {
    database.exec(`ALTER TABLE carousel_sets ADD COLUMN target_brand TEXT NOT NULL DEFAULT 'Locked-In Supply'`);
  }
  if (!carouselColumns.some((column) => column.name === "source_context_json")) database.exec(`ALTER TABLE carousel_sets ADD COLUMN source_context_json TEXT`);
  if (!carouselColumns.some((column) => column.name === "plan_json")) database.exec(`ALTER TABLE carousel_sets ADD COLUMN plan_json TEXT`);
  if (!carouselColumns.some((column) => column.name === "visual_system_json")) database.exec(`ALTER TABLE carousel_sets ADD COLUMN visual_system_json TEXT`);
  if (!carouselColumns.some((column) => column.name === "style_file_name")) database.exec(`ALTER TABLE carousel_sets ADD COLUMN style_file_name TEXT`);
  const referenceColumns = database.prepare(`PRAGMA table_info(reference_assets)`).all() as Array<{ name: string }>;
  if (!referenceColumns.some((column) => column.name === "saved")) database.exec(`ALTER TABLE reference_assets ADD COLUMN saved INTEGER NOT NULL DEFAULT 1 CHECK (saved IN (0, 1))`);
  if (!referenceColumns.some((column) => column.name === "saved_name")) database.exec(`ALTER TABLE reference_assets ADD COLUMN saved_name TEXT`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_assets (
      id TEXT PRIMARY KEY,
      carousel_id TEXT NOT NULL REFERENCES carousel_sets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('etb','bundle','booster_box')),
      label TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_limit INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('resolving','upload_required','mask_review','approved','failed')),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('official_page','upload')),
      source_page_url TEXT,
      source_image_url TEXT,
      original_file_name TEXT,
      prepared_file_name TEXT,
      mask_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (carousel_id, kind)
    );
    CREATE INDEX IF NOT EXISTS product_assets_carousel_idx ON product_assets(carousel_id, kind);
    CREATE TABLE IF NOT EXISTS generation_cost_events (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('test_image','carousel_slide')),
      source_id TEXT NOT NULL,
      model TEXT NOT NULL,
      cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
      usage_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generation_cost_events_created_idx ON generation_cost_events(created_at DESC);
    CREATE TABLE IF NOT EXISTS generation_budget_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      starting_balance_usd REAL NOT NULL CHECK (starting_balance_usd >= 0),
      baseline_spend_usd REAL NOT NULL CHECK (baseline_spend_usd >= 0),
      updated_at TEXT NOT NULL
    );
  `);
  const outputColumns = database.prepare(`PRAGMA table_info(generation_outputs)`).all() as Array<{ name: string }>;
  if (!outputColumns.some((column) => column.name === "cost_usd")) database.exec(`ALTER TABLE generation_outputs ADD COLUMN cost_usd REAL`);
  if (!outputColumns.some((column) => column.name === "usage_json")) database.exec(`ALTER TABLE generation_outputs ADD COLUMN usage_json TEXT`);
  const slideColumns = database.prepare(`PRAGMA table_info(carousel_slides)`).all() as Array<{ name: string }>;
  if (!slideColumns.some((column) => column.name === "model")) database.exec(`ALTER TABLE carousel_slides ADD COLUMN model TEXT`);
  if (!slideColumns.some((column) => column.name === "cost_usd")) database.exec(`ALTER TABLE carousel_slides ADD COLUMN cost_usd REAL`);
  if (!slideColumns.some((column) => column.name === "usage_json")) database.exec(`ALTER TABLE carousel_slides ADD COLUMN usage_json TEXT`);
  database.prepare(`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)`).run(new Date().toISOString());
  database.prepare(`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)`).run(new Date().toISOString());
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
    saved: Boolean(row.saved),
    savedName: row.saved_name,
  };
}

export function listReferenceLibrary(): ReferenceLibraryResponse {
  const rows = getDatabase()
    .prepare(
      `SELECT id, creator_id, creator_name, creator_handle, platform,
              media_type, thumbnail_url, media_url, post_url, caption,
              published_at, views, likes, duration_seconds, selected, saved, saved_name
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

export function updateSavedReference(id: string, saved: boolean, savedName?: string | null) {
  const db = getDatabase();
  const existing = db.prepare(`SELECT id, media_type FROM reference_assets WHERE id = ?`).get(id) as { id: string; media_type: ReferenceMediaType } | undefined;
  if (!existing) throw new Error("Reference was not found.");
  if (saved && existing.media_type !== "image") throw new Error("Only image references can be saved for carousel automation.");
  const cleanName = typeof savedName === "string" ? savedName.trim().slice(0, 80) : null;
  db.prepare(`UPDATE reference_assets SET saved = ?, saved_name = ? WHERE id = ?`).run(saved ? 1 : 0, saved ? cleanName || null : null, id);
  return listReferenceLibrary();
}

export function listSavedImageReferences() {
  return getDatabase().prepare(`
    SELECT id, creator_id, creator_name, creator_handle, platform, media_type,
           thumbnail_url, media_url, post_url, caption, published_at, views,
           likes, duration_seconds, selected, saved, saved_name
    FROM reference_assets
    WHERE saved = 1 AND media_type = 'image'
    ORDER BY selected DESC, published_at DESC, id
  `).all().map((row) => toAsset(row as AssetRow));
}

export function getReferenceMedia(id: string) {
  return getDatabase()
    .prepare(
      `SELECT id, platform, media_type, thumbnail_url, media_url, post_url
       FROM reference_assets WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        platform: ReferencePlatform;
        media_type: ReferenceMediaType;
        thumbnail_url: string;
        media_url: string;
        post_url: string | null;
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
            ra.platform, ra.media_type, ra.caption, ra.post_url,
            ran.model, ran.frame_count,
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
            go.model, go.cost_usd, go.usage_json, go.topic_style_id,
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
      caption: string | null;
      post_url: string | null;
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
      cost_usd: number | null;
      usage_json: string | null;
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
        sourceCaption: row.caption,
        sourcePostUrl: row.post_url,
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
        sourceMediaUrl: publicMediaPath(row.reference_id, "media"),
        sourceCaption: row.caption,
        sourcePostUrl: row.post_url,
        model: row.model,
        costUsd: row.cost_usd,
        usage: row.usage_json ? JSON.parse(row.usage_json) as ImageGenerationUsage : null,
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
  costUsd: number | null;
  usage: ImageGenerationUsage | null;
  topicStyleId: string;
}) {
  const db = getDatabase();
  ensureTestingCollection(db);
  db.prepare(
    `INSERT INTO generation_outputs(
       id, collection_id, reference_id, title, file_name,
       model, cost_usd, usage_json, topic_style_id, created_at
     ) VALUES (?, 'testing', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.referenceId,
    input.title,
    input.fileName,
    input.model,
    input.costUsd,
    input.usage ? JSON.stringify(input.usage) : null,
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
  instruction: string | null; file_name: string | null; error: string | null; model: string | null;
  cost_usd: number | null; usage_json: string | null; created_at: string;
}): CarouselSlide {
  return {
    id: row.id,
    carouselId: row.carousel_id,
    position: row.position,
    status: row.status,
    instruction: row.instruction,
    imageUrl: row.file_name ? `/api/carousels/${encodeURIComponent(row.carousel_id)}/slides/${row.position}/image` : null,
    error: row.error,
    model: row.model,
    costUsd: row.cost_usd,
    usage: row.usage_json ? JSON.parse(row.usage_json) as ImageGenerationUsage : null,
    createdAt: row.created_at,
  };
}

function productAsset(row: {
  id:string; carousel_id:string; kind:CarouselProductAsset["kind"]; label:string; sku:string; product_limit:number;
  status:ProductAssetStatus; source_kind:CarouselProductAsset["sourceKind"]; source_page_url:string|null;
  source_image_url:string|null; original_file_name:string|null; prepared_file_name:string|null; mask_json:string; error:string|null;
}): CarouselProductAsset {
  return {
    id: row.id, carouselId: row.carousel_id, kind: row.kind, label: row.label, sku: row.sku, limit: row.product_limit,
    status: row.status, sourceKind: row.source_kind, sourcePageUrl: row.source_page_url, sourceImageUrl: row.source_image_url,
    originalImageUrl: row.original_file_name ? `/api/carousels/${encodeURIComponent(row.carousel_id)}/products/${encodeURIComponent(row.id)}/image?kind=original` : null,
    preparedImageUrl: row.prepared_file_name ? `/api/carousels/${encodeURIComponent(row.carousel_id)}/products/${encodeURIComponent(row.id)}/image?kind=prepared` : null,
    masks: JSON.parse(row.mask_json) as ProductMaskRegion[], error: row.error,
  };
}

function buildPlan(context: DraftContextGroup): CarouselPlan {
  return {
    sourceContextKey: context.key,
    slides: [
      { position: 1, purpose: "Announce the raffle", headline: "WEDNESDAY RAFFLE", lines: ["NEW RELEASE", "EXACT TIME NOT CONFIRMED"], productKinds: ["etb"], factualSupport: [context.key], visualDirection: "High-impact announcement with strong negative space." },
      { position: 2, purpose: "Show verified product limits", headline: "PRODUCT LIMITS", lines: context.products.map((product) => `${product.label.toUpperCase()} — ${product.limit}`), productKinds: context.products.map((product) => product.kind), factualSupport: [context.key], visualDirection: "Structured comparison grid for three product limits." },
      { position: 3, purpose: "Close with the timing caveat", headline: "BEFORE ENTRY", lines: ["LIMITS ARE SET", "EXACT TIME NOT CONFIRMED", "CHECK DETAILS BEFORE ENTRY"], productKinds: context.products.map((product) => product.kind), factualSupport: [context.key], visualDirection: "Calm checklist close with a prominent timing caveat." },
    ],
  };
}

export function createCarouselSet(input: { name: string; targetBrand: string; anchorReferenceId: string; topicStyleId: string; slideCount: number; subject: string; sourceContext?: DraftContextGroup | null; plan?: CarouselPlan | null; prepareProductAssets?: boolean }) {
  if (input.slideCount < 3 || input.slideCount > 10) throw new Error("Slide count must be between 3 and 10.");
  const db = getDatabase();
  const anchor = db.prepare(`SELECT id, media_type FROM reference_assets WHERE id = ?`).get(input.anchorReferenceId) as { id: string; media_type: ReferenceMediaType } | undefined;
  if (!anchor) throw new Error("Anchor reference was not found.");
  if (anchor.media_type !== "image") throw new Error("Carousel anchors must be image references.");
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const plan = input.plan ?? (input.sourceContext && input.sourceContext.products.length > 0 ? buildPlan(input.sourceContext) : null);
  const prepareProductAssets = input.prepareProductAssets ?? true;
  db.transaction(() => {
    db.prepare(`INSERT INTO carousel_sets(id,name,target_brand,anchor_reference_id,topic_style_id,slide_count,subject,status,source_context_json,plan_json,visual_system_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, input.name.trim() || "Untitled carousel", input.targetBrand.trim() || "Locked-In Supply", input.anchorReferenceId, input.topicStyleId, input.slideCount, input.subject.trim() || "Original visual story", "in_progress", input.sourceContext ? JSON.stringify(input.sourceContext) : null, plan ? JSON.stringify(plan) : null, plan ? JSON.stringify({ palette: ["#d9ef58", "#43ced0", "#081713"], typography: "bold condensed editorial", maskTreatment: "Locked-In Supply cover panels" }) : null, createdAt);
    const statement = db.prepare(`INSERT INTO carousel_slides(id,carousel_id,position,status,instruction,created_at) VALUES (?,?,?,?,?,?)`);
    for (let position = 1; position <= input.slideCount; position += 1) statement.run(randomUUID(), id, position, "pending", null, createdAt);
    if (input.sourceContext && prepareProductAssets) {
      const assetStatement = db.prepare(`INSERT INTO product_assets(id,carousel_id,kind,label,sku,product_limit,status,source_kind,source_page_url,mask_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'[]',?,?)`);
      for (const product of input.sourceContext.products) assetStatement.run(randomUUID(), id, product.kind, product.label, product.sku, product.limit, "resolving", "official_page", `https://www.pokemoncenter.com/product/${encodeURIComponent(product.sku)}/`, createdAt, createdAt);
    }
  })();
  return getCarouselSet(id)!;
}

export function getCarouselSet(id: string): CarouselSet | undefined {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT cs.id, cs.name, cs.target_brand, cs.anchor_reference_id, cs.topic_style_id,
           cs.slide_count, cs.subject, cs.status, cs.source_context_json, cs.plan_json, cs.visual_system_json, cs.created_at,
           ra.creator_name, ra.creator_handle, ra.platform, ra.media_type,
           ra.caption, ra.post_url
    FROM carousel_sets cs
    JOIN reference_assets ra ON ra.id = cs.anchor_reference_id
    WHERE cs.id = ?
  `).get(id) as {
    id:string; name:string; target_brand:string; anchor_reference_id:string; topic_style_id:string;
    slide_count:number; subject:string; status:CarouselSet["status"]; source_context_json:string|null; plan_json:string|null; visual_system_json:string|null; created_at:string;
    creator_name:string; creator_handle:string; platform:ReferencePlatform;
    media_type:ReferenceMediaType; caption:string|null; post_url:string|null;
  } | undefined;
  if (!row) return undefined;
  const slides = db.prepare(`SELECT id,carousel_id,position,status,instruction,file_name,error,model,cost_usd,usage_json,created_at FROM carousel_slides WHERE carousel_id = ? ORDER BY position`).all(id) as Parameters<typeof carouselSlide>[0][];
  const assetRows = db.prepare(`SELECT id,carousel_id,kind,label,sku,product_limit,status,source_kind,source_page_url,source_image_url,original_file_name,prepared_file_name,mask_json,error FROM product_assets WHERE carousel_id = ? ORDER BY CASE kind WHEN 'etb' THEN 1 WHEN 'bundle' THEN 2 ELSE 3 END`).all(id) as Parameters<typeof productAsset>[0][];
  return {
    id: row.id,
    name: row.name,
    targetBrand: row.target_brand,
    anchorReferenceId: row.anchor_reference_id,
    anchor: {
      id: row.anchor_reference_id,
      creatorName: row.creator_name,
      creatorHandle: row.creator_handle,
      platform: row.platform,
      mediaType: row.media_type,
      thumbnailUrl: publicMediaPath(row.anchor_reference_id, "thumbnail"),
      mediaUrl: publicMediaPath(row.anchor_reference_id, "media"),
      caption: row.caption,
      postUrl: row.post_url,
    },
    topicStyleId: row.topic_style_id,
    slideCount: row.slide_count,
    subject: row.subject,
    sourceContext: row.source_context_json ? JSON.parse(row.source_context_json) as DraftContextGroup : null,
    plan: row.plan_json ? JSON.parse(row.plan_json) as CarouselPlan : null,
    visualSystem: row.visual_system_json ? JSON.parse(row.visual_system_json) as CarouselVisualSystem : null,
    productAssets: assetRows.map(productAsset),
    status: row.status,
    slides: slides.map(carouselSlide),
    createdAt: row.created_at,
  };
}

export function updateCarouselVisualSystem(carouselId: string, visualSystem: CarouselVisualSystem, styleFileName: string | null) {
  getDatabase().prepare(`UPDATE carousel_sets SET visual_system_json = ?, style_file_name = ? WHERE id = ?`).run(JSON.stringify(visualSystem), styleFileName, carouselId);
  return getCarouselSet(carouselId);
}

export function getCarouselProductAsset(carouselId: string, assetId: string) {
  const row = getDatabase().prepare(`SELECT id,carousel_id,kind,label,sku,product_limit,status,source_kind,source_page_url,source_image_url,original_file_name,prepared_file_name,mask_json,error FROM product_assets WHERE carousel_id = ? AND id = ?`).get(carouselId, assetId) as Parameters<typeof productAsset>[0] | undefined;
  return row ? productAsset(row) : undefined;
}

export function updateCarouselProductAsset(input: { carouselId:string; assetId:string; status:ProductAssetStatus; sourceKind?:CarouselProductAsset["sourceKind"]; sourceImageUrl?:string|null; originalFileName?:string|null; preparedFileName?:string|null; masks?:ProductMaskRegion[]; error?:string|null }) {
  const db = getDatabase();
  db.prepare(`UPDATE product_assets SET status=?, source_kind=COALESCE(?,source_kind), source_image_url=COALESCE(?,source_image_url), original_file_name=COALESCE(?,original_file_name), prepared_file_name=COALESCE(?,prepared_file_name), mask_json=COALESCE(?,mask_json), error=?, updated_at=? WHERE carousel_id=? AND id=?`).run(input.status, input.sourceKind ?? null, input.sourceImageUrl ?? null, input.originalFileName ?? null, input.preparedFileName ?? null, input.masks ? JSON.stringify(input.masks) : null, input.error ?? null, new Date().toISOString(), input.carouselId, input.assetId);
  return getCarouselSet(input.carouselId);
}

export function getCarouselProductFile(carouselId: string, assetId: string, kind: "original" | "prepared") {
  const column = kind === "prepared" ? "prepared_file_name" : "original_file_name";
  return getDatabase().prepare(`SELECT ${column} AS file_name FROM product_assets WHERE carousel_id = ? AND id = ?`).get(carouselId, assetId) as {file_name:string|null} | undefined;
}

export function updateCarouselSlide(input: { carouselId: string; position: number; status: CarouselSlide["status"]; instruction?: string | null; fileName?: string | null; error?: string | null; model?: string | null; costUsd?: number | null; usage?: ImageGenerationUsage | null }) {
  const db = getDatabase();
  const assignments = ["status = ?"];
  const values: unknown[] = [input.status];
  if (input.instruction !== undefined) { assignments.push("instruction = ?"); values.push(input.instruction); }
  if (input.fileName !== undefined) { assignments.push("file_name = ?"); values.push(input.fileName); }
  if (input.error !== undefined) { assignments.push("error = ?"); values.push(input.error); }
  if (input.model !== undefined) { assignments.push("model = ?"); values.push(input.model); }
  if (input.costUsd !== undefined) { assignments.push("cost_usd = ?"); values.push(input.costUsd); }
  if (input.usage !== undefined) { assignments.push("usage_json = ?"); values.push(input.usage ? JSON.stringify(input.usage) : null); }
  db.prepare(`UPDATE carousel_slides SET ${assignments.join(", ")} WHERE carousel_id = ? AND position = ?`).run(...values, input.carouselId, input.position);
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

export function recordGenerationCost(input: { sourceType: "test_image" | "carousel_slide"; sourceId: string; model: string; costUsd: number; usage: ImageGenerationUsage }) {
  getDatabase().prepare(`INSERT INTO generation_cost_events(id,source_type,source_id,model,cost_usd,usage_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), input.sourceType, input.sourceId, input.model, input.costUsd, JSON.stringify(input.usage), new Date().toISOString());
}

export function getGenerationBudget(): GenerationBudget {
  const rawBudget = process.env.OPENAI_IMAGE_BUDGET_USD?.trim();
  const row = getDatabase().prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM generation_cost_events`).get() as { spent: number };
  const spentUsd = Math.max(0, row.spent);
  const saved = getDatabase().prepare(`SELECT starting_balance_usd, baseline_spend_usd FROM generation_budget_config WHERE id = 1`).get() as { starting_balance_usd: number; baseline_spend_usd: number } | undefined;
  const environmentBudget = rawBudget ? Number(rawBudget) : Number.NaN;
  const initialBudgetUsd = saved?.starting_balance_usd ?? environmentBudget;
  const baselineSpendUsd = saved?.baseline_spend_usd ?? 0;
  const configured = Number.isFinite(initialBudgetUsd) && initialBudgetUsd >= 0;
  const trackedSpendUsd = Math.max(0, spentUsd - baselineSpendUsd);
  const remainingUsd = configured ? Math.max(0, initialBudgetUsd - trackedSpendUsd) : null;
  const warningThresholdUsd = 3;
  return {
    configured,
    initialBudgetUsd: configured ? initialBudgetUsd : null,
    spentUsd: trackedSpendUsd,
    remainingUsd,
    warningThresholdUsd,
    low: remainingUsd !== null && remainingUsd < warningThresholdUsd,
  };
}

export function setGenerationBudget(balanceUsd: number) {
  if (!Number.isFinite(balanceUsd) || balanceUsd < 0 || balanceUsd > 1_000_000) throw new Error("Enter a valid current balance.");
  const db = getDatabase();
  const row = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM generation_cost_events`).get() as { spent: number };
  db.prepare(`INSERT INTO generation_budget_config(id,starting_balance_usd,baseline_spend_usd,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET starting_balance_usd=excluded.starting_balance_usd,baseline_spend_usd=excluded.baseline_spend_usd,updated_at=excluded.updated_at`)
    .run(balanceUsd, Math.max(0, row.spent), new Date().toISOString());
  return getGenerationBudget();
}
