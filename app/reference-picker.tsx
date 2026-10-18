"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type {
  ReferenceAnalysisResponse,
  ReferenceAsset,
  ReferenceCreator,
  ReferenceLibraryResponse,
} from "../lib/reference-types";
import ReferenceLightbox from "./reference-lightbox";
import ReliableImage from "./reliable-image";
import GenerationCostStatus, { generationCostLabel, notifyGenerationCostChanged } from "./generation-cost-status";
import type { TopicStyleId } from "./topic-styles";

type ReferencePickerProps = {
  mode: "workflow" | "library";
  topicStyleName?: string;
  topicStyleId?: TopicStyleId | null;
  onBack?: () => void;
  onStartCarousel?: (anchor: ReferenceAsset) => void;
};

function compactNumber(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function publishedLabel(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function creatorInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function ReferencePicker({
  mode,
  topicStyleName,
  topicStyleId,
  onBack,
  onStartCarousel,
}: ReferencePickerProps) {
  const isWorkflow = mode === "workflow";
  const [library, setLibrary] = useState<ReferenceLibraryResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openCreatorIds, setOpenCreatorIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ReferenceAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyses, setAnalyses] = useState<Record<string, ReferenceAnalysisResponse>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLibrary() {
      try {
        const response = await fetch("/api/references", { cache: "no-store" });
        const payload = (await response.json()) as
          | ReferenceLibraryResponse
          | { error?: string };
        if (!response.ok || !("creators" in payload)) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "The reference library could not be loaded.",
          );
        }
        if (cancelled) return;
        setLibrary(payload);
        setSelectedIds(payload.selectedIds.slice(0, 1));
        setOpenCreatorIds(
          new Set(payload.creators[0] ? [payload.creators[0].id] : []),
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The reference library could not be loaded.",
          );
        }
      }
    }

    void loadLibrary();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAssets = useMemo(() => {
    const assets = library?.creators.flatMap((creator) => creator.assets) ?? [];
    return selectedIds.flatMap((id) => {
      const asset = assets.find((candidate) => candidate.id === id);
      return asset ? [asset] : [];
    });
  }, [library, selectedIds]);

  function toggleCreator(creator: ReferenceCreator) {
    setOpenCreatorIds((current) => {
      const next = new Set(current);
      if (next.has(creator.id)) next.delete(creator.id);
      else next.add(creator.id);
      return next;
    });
  }

  async function toggleReference(asset: ReferenceAsset) {
    if (saving) return;
    const wasSelected = selectedIds.includes(asset.id);
    const previous = selectedIds;
    const next = wasSelected ? [] : [asset.id];

    setSelectedIds(next);
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/references", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: next }),
      });
      const payload = (await response.json()) as
        | ReferenceLibraryResponse
        | { error?: string };
      if (!response.ok || !("selectedIds" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "The selection could not be saved.",
        );
      }
      setSelectedIds(payload.selectedIds);
    } catch (saveError) {
      setSelectedIds(previous);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The selection could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleSavedReference(asset: ReferenceAsset) {
    if (saving || asset.mediaType !== "image") return;
    const savedName = asset.saved ? null : window.prompt("Name this saved reference for Telegram", asset.savedName || `${asset.creatorHandle} reference`);
    if (!asset.saved && savedName === null) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/references", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: asset.id, saved: !asset.saved, savedName }),
      });
      const payload = await response.json() as ReferenceLibraryResponse | { error?: string };
      if (!response.ok || !("creators" in payload)) throw new Error("error" in payload ? payload.error : "The saved reference could not be updated.");
      setLibrary(payload);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The saved reference could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function analyzePreview(asset: ReferenceAsset) {
    if (analyzingId) return;
    setAnalyzingId(asset.id);
    setAnalysisError(null);
    try {
      const response = await fetch(`/api/references/${asset.id}/analyze`, {
        method: "POST",
      });
      const payload = (await response.json()) as
        | ReferenceAnalysisResponse
        | { error?: string };
      if (!response.ok || !("analysis" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "OpenAI could not analyze this reference.",
        );
      }
      setAnalyses((current) => ({ ...current, [asset.id]: payload }));
    } catch (analysisFailure) {
      setAnalysisError(
        analysisFailure instanceof Error
          ? analysisFailure.message
          : "OpenAI could not analyze this reference.",
      );
    } finally {
      setAnalyzingId(null);
    }
  }

  async function generatePreview(asset: ReferenceAsset) {
    if (!topicStyleId || generatingId) return;
    setGeneratingId(asset.id);
    setGenerationMessage(null);
    try {
      const response = await fetch("/api/generations/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenceId: asset.id, topicStyleId }),
      });
      const payload = (await response.json()) as { error?: string; title?: string; costUsd?: number | null };
      if (!response.ok) throw new Error(payload.error || "The finished image could not be generated.");
      notifyGenerationCostChanged();
      setGenerationMessage(`${payload.title || "Finished test image"} saved in Generations · ${generationCostLabel(payload.costUsd ?? null)}.`);
    } catch (generationError) {
      setGenerationMessage(
        generationError instanceof Error
          ? generationError.message
          : "The finished image could not be generated.",
      );
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <section className="reference-screen">
      <header className="reference-header">
        {isWorkflow && onBack && (
          <button type="button" className="back-button" onClick={onBack}>
            <span aria-hidden="true">←</span> Topic style
          </button>
        )}
        {isWorkflow ? (
          <div className="style-context">
            <span>Story style</span>
            <strong>{topicStyleName}</strong>
          </div>
        ) : (
          <div className="style-context">
            <span>Apify import</span>
            <strong>{library ? `${library.totalAssets} assets` : "Loading"}</strong>
          </div>
        )}
        <p className="eyebrow">
          {isWorkflow ? "Build your visual moodboard" : "Reference library"}
        </p>
          <h1>{isWorkflow ? "Choose one anchor reference" : "Explore your references"}</h1>
        <p className="supporting-copy">
          {isWorkflow
            ? "Choose one image as the visual anchor. Every carousel slide will be newly generated around its visual language."
            : "Browse the TikTok and Instagram media pulled from Apify, organized by creator."}
        </p>
        {isWorkflow && (
          <div className={`selection-meter ${selectedIds.length === 1 ? "complete" : ""}`}>
            <div>
              {[0].map((slot) => (
                <span key={slot} className={slot < selectedIds.length ? "filled" : ""} />
              ))}
            </div>
            <strong>{selectedIds.length} / 1 selected</strong>
          </div>
        )}
      </header>
      {topicStyleId && <GenerationCostStatus />}

      {error && (
        <motion.div
          className="reference-alert"
          role="alert"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}
      {generationMessage && (
        <motion.div className="reference-success" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          {generationMessage}
        </motion.div>
      )}

      {!library && !error && (
        <div className="reference-loading" role="status">
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
          Opening the reference library…
        </div>
      )}

      {library && (
        <div className="creator-drawers">
          {library.creators.map((creator, creatorIndex) => {
            const isOpen = openCreatorIds.has(creator.id);
            const selectedCount = creator.assets.filter((asset) =>
              selectedIds.includes(asset.id),
            ).length;
            const platformCount = new Set(
              creator.assets.map((asset) => asset.platform),
            ).size;

            return (
              <motion.article
                key={creator.id}
                className={`creator-drawer ${isOpen ? "open" : ""}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: creatorIndex * 0.07 }}
              >
                <button
                  type="button"
                  className="creator-drawer-trigger"
                  aria-expanded={isOpen}
                  aria-controls={`creator-${creator.id}`}
                  onClick={() => toggleCreator(creator)}
                >
                  <span className="creator-avatar">{creatorInitials(creator.name)}</span>
                  <span className="creator-identity">
                    <strong>{creator.name}</strong>
                    <small>@{creator.handle}</small>
                  </span>
                  <span className="creator-summary">
                    {creator.assets.length} pieces · {platformCount} {platformCount === 1 ? "platform" : "platforms"}
                  </span>
                  {selectedCount > 0 && (
                    <span className="creator-selected-count">{selectedCount} chosen</span>
                  )}
                  <motion.span
                    className="drawer-chevron"
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    aria-hidden="true"
                  >
                    ↓
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`creator-${creator.id}`}
                      className="creator-drawer-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: "easeOut" }}
                    >
                      <div className="reference-grid">
                        {creator.assets.map((asset) => {
                          const isSelected = selectedIds.includes(asset.id);
                          return (
                            <article
                              key={asset.id}
                              className={`reference-card ${isSelected ? "selected" : ""}`}
                            >
                              <button
                                type="button"
                                className="media-preview-button"
                                onClick={() => setPreview(asset)}
                                aria-label={`Preview ${asset.mediaType} from ${creator.name}`}
                              >
                                <ReliableImage
                                  src={asset.thumbnailUrl}
                                  alt=""
                                  fill
                                  sizes="(max-width: 640px) 50vw, 210px"
                                  fallbackLabel="Reference thumbnail unavailable"
                                />
                                <span className="media-shade" />
                                <span className="platform-pill">{asset.platform}</span>
                                <span className="media-kind-pill">
                                  {asset.mediaType === "video" ? "▶ Video" : "Image"}
                                </span>
                                <span className="preview-hint">Preview</span>
                              </button>

                              <div className="reference-card-copy">
                                <p>{asset.caption?.trim() || "Untitled reference"}</p>
                                <div>
                                  <span>{publishedLabel(asset.publishedAt)}</span>
                                  {asset.views !== null && (
                                    <span>{compactNumber(asset.views)} views</span>
                                  )}
                                </div>
                              </div>

                              {isWorkflow && (
                                <button
                                  type="button"
                                  className="reference-select-button"
                                  aria-pressed={isSelected}
                                  disabled={saving || (isWorkflow && asset.mediaType !== "image")}
                                  onClick={() => void toggleReference(asset)}
                                >
                                  <span aria-hidden="true">{isSelected ? "✓" : "+"}</span>
                                  {asset.mediaType !== "image" && isWorkflow ? "Image only" : isSelected ? "Selected" : "Choose"}
                                </button>
                              )}
                              {!isWorkflow && asset.mediaType === "image" && (
                                <button
                                  type="button"
                                  className="reference-select-button"
                                  aria-pressed={asset.saved}
                                  disabled={saving}
                                  onClick={() => void toggleSavedReference(asset)}
                                >
                                  <span aria-hidden="true">{asset.saved ? "★" : "☆"}</span>
                                  {asset.saved ? asset.savedName || "Saved for automation" : "Save for automation"}
                                </button>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.article>
            );
          })}
        </div>
      )}

      {library && isWorkflow && (
          <div className={`selection-dock ${selectedIds.length === 1 ? "ready" : ""}`}>
          <div className="selected-thumbnails">
            {[0].map((slot) => {
              const asset = selectedAssets[slot];
              return asset ? (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setPreview(asset)}
                  aria-label={`Preview selected reference ${slot + 1}`}
                >
                  <ReliableImage src={asset.thumbnailUrl} alt="" fill sizes="44px" fallbackLabel="Thumbnail unavailable" />
                </button>
              ) : (
                <span key={slot}>{slot + 1}</span>
              );
            })}
          </div>
          <div className="dock-copy">
            <strong>
              {selectedIds.length === 1 ? "Your anchor is ready" : "Choose one image anchor"}
            </strong>
            <small>
              {selectedIds.length === 1
                ? "Generate a new, original slide sequence around this image."
                : "Choose one image before slide generation can begin."}
            </small>
          </div>
          <button type="button" className="generation-button" disabled={selectedIds.length !== 1} onClick={() => selectedAssets[0] && onStartCarousel?.(selectedAssets[0])}>
            Generate slides
            <span aria-hidden="true">✦</span>
          </button>
        </div>
      )}

      <ReferenceLightbox
        asset={preview}
        analysis={preview ? analyses[preview.id] : undefined}
        analysisError={analysisError}
        analyzing={Boolean(preview && analyzingId === preview.id)}
        isSelected={Boolean(preview && selectedIds.includes(preview.id))}
        saving={saving}
        generating={Boolean(preview && generatingId === preview.id)}
        topicStyleId={topicStyleId}
        selectionEnabled={isWorkflow}
        onClose={() => {
          setPreview(null);
          setAnalysisError(null);
        }}
        onAnalyze={(asset) => void analyzePreview(asset)}
        onToggleSelection={(asset) => void toggleReference(asset)}
        onGenerate={(asset) => void generatePreview(asset)}
      />
    </section>
  );
}
