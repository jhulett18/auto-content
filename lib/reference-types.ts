export type ReferencePlatform = "Instagram" | "TikTok";
export type ReferenceMediaType = "image" | "video";

export type DraftAttachment = { name: string; url: string };
export type ProductKind = "etb" | "bundle" | "booster_box";
export type ProductRequirement = { kind: ProductKind; label: string; sku: string; limit: number };
export type DraftContextGroup = {
  key: string;
  author: string;
  timestamp: string;
  text: string;
  attachments: DraftAttachment[];
  products: ProductRequirement[];
};

export type ProductMaskRegion = {
  id: string;
  kind: "brand_name" | "logo" | "character_art" | "set_mark" | "symbol" | "other";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProductAssetStatus = "resolving" | "upload_required" | "mask_review" | "approved" | "failed";
export type CarouselProductAsset = ProductRequirement & {
  id: string;
  carouselId: string;
  status: ProductAssetStatus;
  sourceKind: "official_page" | "upload";
  sourcePageUrl: string | null;
  sourceImageUrl: string | null;
  originalImageUrl: string | null;
  preparedImageUrl: string | null;
  masks: ProductMaskRegion[];
  error: string | null;
};

export type CarouselPlanSlide = {
  position: number;
  purpose: string;
  headline: string;
  lines: string[];
  productKinds: ProductKind[];
  factualSupport: string[];
  visualDirection: string;
};

export type CarouselPlan = { sourceContextKey: string; slides: CarouselPlanSlide[] };
export type CarouselVisualSystem = { palette: [string, string, string]; typography: string; maskTreatment: string };

export type ReferenceAsset = {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorHandle: string;
  platform: ReferencePlatform;
  mediaType: ReferenceMediaType;
  thumbnailUrl: string;
  mediaUrl: string;
  postUrl: string | null;
  caption: string | null;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  durationSeconds: number | null;
  selected: boolean;
  saved: boolean;
  savedName: string | null;
};

export type ReferenceCreator = {
  id: string;
  name: string;
  handle: string;
  assets: ReferenceAsset[];
};

export type ReferenceLibraryResponse = {
  creators: ReferenceCreator[];
  totalAssets: number;
  selectedIds: string[];
};

export type ReferenceAnalysisResult = {
  summary: string;
  visualStyle: {
    colorPalette: string[];
    composition: string;
    typography: string;
    imagery: string;
    lighting: string;
    texture: string;
  };
  contentStrategy: {
    hook: string;
    pacing: string;
    storyStructure: string;
    cta: string;
  };
  reusablePatterns: string[];
  avoidCopying: string[];
  frameNotes: string[];
};

export type ReferenceAnalysisResponse = {
  referenceId: string;
  mediaType: ReferenceMediaType;
  model: string;
  frameCount: number;
  durationMs: number;
  cached: boolean;
  analysis: ReferenceAnalysisResult;
};

export type GenerationItem = {
  id: string;
  referenceId: string;
  title: string;
  creatorName: string;
  creatorHandle: string;
  platform: ReferencePlatform;
  mediaType: ReferenceMediaType;
  thumbnailUrl: string;
  mediaUrl: string;
  sourceCaption: string | null;
  sourcePostUrl: string | null;
  model: string;
  frameCount: number;
  durationMs: number;
  analysis: ReferenceAnalysisResult;
};

export type GenerationReference = {
  id: string;
  creatorName: string;
  creatorHandle: string;
  platform: ReferencePlatform;
  mediaType: ReferenceMediaType;
  thumbnailUrl: string;
  mediaUrl: string;
  caption: string | null;
  postUrl: string | null;
};

export type GenerationCollection = {
  id: string;
  label: string;
  kind: "analysis-showcase";
  createdAt: string;
  items: GenerationItem[];
  outputs: GenerationOutput[];
};

export type GenerationOutput = {
  id: string;
  title: string;
  referenceId: string;
  creatorName: string;
  creatorHandle: string;
  platform: ReferencePlatform;
  imageUrl: string;
  sourceThumbnailUrl: string;
  sourceMediaUrl: string;
  sourceCaption: string | null;
  sourcePostUrl: string | null;
  model: string;
  costUsd: number | null;
  usage: ImageGenerationUsage | null;
  topicStyleId: string;
  createdAt: string;
};

export type GenerationLibraryResponse = {
  collections: GenerationCollection[];
  totalItems: number;
  carousels?: CarouselSet[];
};

export type CarouselSlideStatus = "pending" | "generating" | "generated" | "kept" | "failed";

export type CarouselSlide = {
  id: string;
  carouselId: string;
  position: number;
  status: CarouselSlideStatus;
  instruction: string | null;
  imageUrl: string | null;
  error: string | null;
  model: string | null;
  costUsd: number | null;
  usage: ImageGenerationUsage | null;
  createdAt: string;
};

export type ImageGenerationUsage = {
  inputTokens: number;
  textInputTokens: number;
  imageInputTokens: number;
  outputTokens: number;
};

export type GenerationBudget = {
  configured: boolean;
  initialBudgetUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  warningThresholdUsd: number;
  low: boolean;
};

export type CarouselSet = {
  id: string;
  name: string;
  targetBrand: string;
  anchorReferenceId: string;
  anchor: GenerationReference;
  topicStyleId: string;
  slideCount: number;
  subject: string;
  sourceContext: DraftContextGroup | null;
  plan: CarouselPlan | null;
  visualSystem: CarouselVisualSystem | null;
  productAssets: CarouselProductAsset[];
  status: "in_progress" | "completed";
  slides: CarouselSlide[];
  createdAt: string;
};

export type DailyCandidateSignals = {
  events: string[];
  urgency: string[];
  details: string[];
  corrections: string[];
  score: number;
  explanation: string[];
};

export type DailyWorkflowVariation = {
  id: string;
  label: "A" | "B";
  carouselId: string;
  status: "pending" | "generating" | "ready" | "failed" | "approved" | "rejected";
  reviewStatus: "pending" | "passed" | "failed";
  reviewNotes: string[];
  error: string | null;
};

export type DailyWorkflowRun = {
  id: string;
  runDate: string;
  status: "collecting" | "generating" | "awaiting_approval" | "approved" | "scheduled" | "failed" | "no_candidate" | "rejected";
  candidateKey: string | null;
  candidateText: string | null;
  candidateTimestamp: string | null;
  signals: DailyCandidateSignals | null;
  referenceId: string | null;
  referenceName: string | null;
  caption: string | null;
  scheduledFor: string | null;
  approvedVariation: "A" | "B" | null;
  telegramMessageId: number | null;
  discordMessageId: string | null;
  zernioPostId: string | null;
  error: string | null;
  variations: DailyWorkflowVariation[];
  createdAt: string;
  updatedAt: string;
};
