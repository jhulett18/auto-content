export type ReferencePlatform = "Instagram" | "TikTok";
export type ReferenceMediaType = "image" | "video";

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
  model: string;
  frameCount: number;
  durationMs: number;
  analysis: ReferenceAnalysisResult;
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
  sourceCaption: string | null;
  sourcePostUrl: string | null;
  model: string;
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
  createdAt: string;
};

export type CarouselSet = {
  id: string;
  name: string;
  anchorReferenceId: string;
  topicStyleId: string;
  slideCount: number;
  subject: string;
  status: "in_progress" | "completed";
  slides: CarouselSlide[];
  createdAt: string;
};
