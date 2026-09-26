import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { TopicStyleId } from "./topic-styles";

export type DiagnosticCheck = {
  label: string;
  status: "pass" | "fail";
  detail: string;
};

export type DraftResult = {
  success: boolean;
  summary: string;
  durationMs: number;
  checks: DiagnosticCheck[];
};

export type DraftPath =
  | "/draft/loading"
  | "/draft/result"
  | "/draft/topic-style"
  | "/draft/references"
  | "/draft/carousel";

export type CarouselDraft = {
  anchorReferenceId: string | null;
  subject: string;
  slideCount: number;
  carouselId: string | null;
  currentSlide: number;
};

type WorkflowStore = {
  result: DraftResult | null;
  selectedStyleId: TopicStyleId | null;
  hasActiveDraft: boolean;
  updatedAt: string | null;
  lastDraftPath: DraftPath;
  hydrated: boolean;
  carousel: CarouselDraft;
  beginDraft: () => void;
  completeInitialization: (result: DraftResult) => void;
  setSelectedStyleId: (id: TopicStyleId) => void;
  markDraftPath: (path: DraftPath) => void;
  setHydrated: (hydrated: boolean) => void;
  setCarouselAnchor: (anchorReferenceId: string, subject: string) => void;
  setCarouselDraft: (input: Partial<CarouselDraft>) => void;
};

type LegacyState = {
  result?: DraftResult | null;
  selectedStyleId?: TopicStyleId | null;
  hasActiveDraft?: boolean;
  updatedAt?: string | null;
  resumeScreen?: string;
  carousel?: CarouselDraft;
};

const now = () => new Date().toISOString();

function legacyPath(screen: string | undefined): DraftPath {
  if (screen === "result") return "/draft/result";
  if (screen === "topic-style") return "/draft/topic-style";
  if (screen === "references") return "/draft/references";
  return "/draft/loading";
}

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set) => ({
      result: null,
      selectedStyleId: null,
      hasActiveDraft: false,
      updatedAt: null,
      lastDraftPath: "/draft/loading",
      hydrated: false,
      carousel: { anchorReferenceId: null, subject: "Original visual story", slideCount: 5, carouselId: null, currentSlide: 1 },
      beginDraft: () =>
        set({
          result: null,
          selectedStyleId: null,
          hasActiveDraft: true,
          updatedAt: now(),
          lastDraftPath: "/draft/loading",
          carousel: { anchorReferenceId: null, subject: "Original visual story", slideCount: 5, carouselId: null, currentSlide: 1 },
        }),
      completeInitialization: (result) =>
        set({
          result,
          hasActiveDraft: true,
          updatedAt: now(),
          lastDraftPath: "/draft/result",
        }),
      setSelectedStyleId: (selectedStyleId) =>
        set({ selectedStyleId, hasActiveDraft: true, updatedAt: now() }),
      markDraftPath: (lastDraftPath) =>
        set({ lastDraftPath, hasActiveDraft: true, updatedAt: now() }),
      setHydrated: (hydrated) => set({ hydrated }),
      setCarouselAnchor: (anchorReferenceId, subject) => set({ carousel: { ...useWorkflowStore.getState().carousel, anchorReferenceId, subject }, hasActiveDraft: true, updatedAt: now(), lastDraftPath: "/draft/carousel" }),
      setCarouselDraft: (input: Partial<CarouselDraft>) => set((state) => ({ carousel: { ...state.carousel, ...input }, hasActiveDraft: true, updatedAt: now() })),
    } as WorkflowStore),
    {
      name: "auto-content-workflow",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      skipHydration: true,
      migrate: (persistedState, version) => {
        if (version >= 2) return persistedState as WorkflowStore;
        const legacy = persistedState as LegacyState;
        return {
          result: legacy.result ?? null,
          selectedStyleId: legacy.selectedStyleId ?? null,
          hasActiveDraft: legacy.hasActiveDraft ?? false,
          updatedAt: legacy.updatedAt ?? null,
          lastDraftPath: legacyPath(legacy.resumeScreen),
          carousel: legacy.carousel ?? { anchorReferenceId: null, subject: "Original visual story", slideCount: 5, carouselId: null, currentSlide: 1 },
        };
      },
      partialize: (state) => ({
        result: state.result,
        selectedStyleId: state.selectedStyleId,
        hasActiveDraft: state.hasActiveDraft,
        updatedAt: state.updatedAt,
        lastDraftPath: state.lastDraftPath,
        carousel: state.carousel,
      }),
    },
  ),
);
