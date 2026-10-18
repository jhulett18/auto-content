export type PlanningContextOptions = {
  root?: string;
  weeks?: number;
};

export type PlanningContext = {
  generatedAt: string;
  root: string;
  topicBank: unknown;
  recentPlans: Array<{ file: string; content: string }>;
  referenceLibrary: string;
  savedImageReferences: Array<{
    id: string;
    savedName: string | null;
    creatorHandle: string;
    platform: string;
    mediaType: "image";
    caption: string | null;
    publishedAt: string | null;
  }>;
};

export function collectPlanningContext(options?: PlanningContextOptions): Promise<PlanningContext>;
