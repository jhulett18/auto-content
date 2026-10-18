"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CarouselSet,
  GenerationItem,
  GenerationLibraryResponse,
  GenerationOutput,
  GenerationReference,
} from "../lib/reference-types";
import { TOPIC_STYLES } from "./topic-styles";
import ReliableImage from "./reliable-image";
import GenerationCostStatus, { generationCostLabel } from "./generation-cost-status";
import TikTokPostComposer from "./tiktok-post-composer";

type ReferenceGroup = {
  reference: GenerationReference;
  analysis: GenerationItem | null;
  outputs: GenerationOutput[];
  carousels: CarouselSet[];
};

type RenderedPreview = {
  imageUrl: string;
  title: string;
  label: string;
  promptType: "Test image" | "Carousel slide";
  storyStyle: string;
  meta: string;
  costUsd: number | null;
  reference: GenerationReference;
};

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function topicStyleLabel(id: string) {
  return TOPIC_STYLES.find((style) => style.id === id)?.name ?? id.replaceAll("_", " ");
}

function referenceFromItem(item: GenerationItem): GenerationReference {
  return {
    id: item.referenceId,
    creatorName: item.creatorName,
    creatorHandle: item.creatorHandle,
    platform: item.platform,
    mediaType: item.mediaType,
    thumbnailUrl: item.thumbnailUrl,
    mediaUrl: item.mediaUrl,
    caption: item.sourceCaption,
    postUrl: item.sourcePostUrl,
  };
}

function referenceFromOutput(output: GenerationOutput): GenerationReference {
  return {
    id: output.referenceId,
    creatorName: output.creatorName,
    creatorHandle: output.creatorHandle,
    platform: output.platform,
    mediaType: "image",
    thumbnailUrl: output.sourceThumbnailUrl,
    mediaUrl: output.sourceMediaUrl,
    caption: output.sourceCaption,
    postUrl: output.sourcePostUrl,
  };
}

function groupByReference(library: GenerationLibraryResponse): ReferenceGroup[] {
  const groups = new Map<string, ReferenceGroup>();

  const ensureGroup = (reference: GenerationReference) => {
    const current = groups.get(reference.id);
    if (current) return current;
    const group: ReferenceGroup = {
      reference,
      analysis: null,
      outputs: [],
      carousels: [],
    };
    groups.set(reference.id, group);
    return group;
  };

  for (const collection of library.collections) {
    for (const item of collection.items) {
      ensureGroup(referenceFromItem(item)).analysis = item;
    }
    for (const output of collection.outputs) {
      ensureGroup(referenceFromOutput(output)).outputs.push(output);
    }
  }

  for (const carousel of library.carousels ?? []) {
    ensureGroup(carousel.anchor).carousels.push(carousel);
  }

  const newestOutputAt = (group: ReferenceGroup) => Math.max(
    0,
    ...group.outputs.map((output) => Date.parse(output.createdAt) || 0),
    ...group.carousels.map((carousel) => Date.parse(carousel.createdAt) || 0),
  );

  return [...groups.values()].sort(
    (left, right) => newestOutputAt(right) - newestOutputAt(left),
  );
}

export default function GenerationLibrary() {
  const [library, setLibrary] = useState<GenerationLibraryResponse | null>(null);
  const [analysisPreview, setAnalysisPreview] = useState<GenerationItem | null>(null);
  const [renderedPreview, setRenderedPreview] = useState<RenderedPreview | null>(null);
  const [expandedReference, setExpandedReference] = useState<GenerationReference | null>(null);
  const [tiktokPreview, setTikTokPreview] = useState<RenderedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLibrary = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/generations", {
      cache: "no-store",
      signal,
    });
    const payload = (await response.json()) as
      | GenerationLibraryResponse
      | { error?: string };
    if (!response.ok || !("collections" in payload)) {
      throw new Error(
        "error" in payload && payload.error
          ? payload.error
          : "The generation library could not be loaded.",
      );
    }
    return {
      ...payload,
      collections: payload.collections.map((collection) => ({
        ...collection,
        items: Array.isArray(collection.items) ? collection.items : [],
        outputs: Array.isArray(collection.outputs) ? collection.outputs : [],
      })),
      carousels: Array.isArray(payload.carousels) ? payload.carousels : [],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void loadLibrary(controller.signal)
      .then((payload) => {
        if (!cancelled) setLibrary(payload);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof DOMException && loadError.name === "AbortError"
              ? "The generation library took too long to respond."
              : loadError instanceof Error
                ? loadError.message
                : "The generation library could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadLibrary]);

  useEffect(() => {
    if (!analysisPreview && !renderedPreview && !expandedReference && !tiktokPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (tiktokPreview) setTikTokPreview(null);
        else if (expandedReference) setExpandedReference(null);
        else {
          setAnalysisPreview(null);
          setRenderedPreview(null);
        }
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
    };
  }, [analysisPreview, expandedReference, renderedPreview, tiktokPreview]);

  const groups = useMemo(
    () => (library ? groupByReference(library) : []),
    [library],
  );

  return (
    <motion.section
      className="generation-library-screen"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
    >
      <header className="generation-header">
        <p className="eyebrow">Generation library</p>
        <h1>References and their outputs</h1>
        <p className="supporting-copy">
          See each source beside every test image, carousel set, and individual slide created from it.
        </p>
      </header>
      <GenerationCostStatus />

      {error && (
        <div className="reference-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
      {!library && !error && (
        <div className="reference-loading" role="status">
          <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity }} />
          Opening the generation library…
        </div>
      )}

      {groups.length > 0 && (
        <div className="generation-reference-list">
          {groups.map((group, groupIndex) => {
            const generatedSlides = group.carousels.reduce(
              (count, carousel) => count + carousel.slides.filter((slide) => slide.imageUrl).length,
              0,
            );
            const outputCount = group.outputs.length + generatedSlides;

            return (
              <motion.article
                className="generation-reference-group"
                key={group.reference.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIndex * 0.06 }}
              >
                <aside className="generation-reference-source">
                  <div className="generation-reference-media">
                    <ReliableImage
                      src={group.reference.thumbnailUrl}
                      alt={`Reference from ${group.reference.creatorName}`}
                      fill
                      sizes="(max-width: 760px) 100vw, 240px"
                      fallbackLabel="Reference thumbnail unavailable"
                    />
                    <span className="media-shade" />
                    <span className="platform-pill">{group.reference.platform}</span>
                    <span className="media-kind-pill">Reference</span>
                  </div>
                  <div className="generation-reference-copy">
                    <strong>@{group.reference.creatorHandle}</strong>
                    <small>{group.reference.creatorName}</small>
                    <p>{group.reference.caption?.trim() || "No source caption available."}</p>
                    <div className="generation-reference-actions">
                      {group.analysis && (
                        <button type="button" onClick={() => setAnalysisPreview(group.analysis)}>
                          View analysis
                        </button>
                      )}
                      {group.reference.postUrl && (
                        <a href={group.reference.postUrl} target="_blank" rel="noreferrer">
                          Original post ↗
                        </a>
                      )}
                    </div>
                  </div>
                </aside>

                <div className="generation-reference-results">
                  <div className="generation-results-heading">
                    <div>
                      <span className="testing-label">Created from this reference</span>
                      <h2>{outputCount} rendered {outputCount === 1 ? "slide" : "slides"}</h2>
                    </div>
                    <small>{group.outputs.length > 0 ? `${group.outputs.length} test` : "Regular flow"}</small>
                  </div>

                  {group.outputs.length > 0 && (
                    <section className="generation-output-block">
                      <div className="generation-output-block-heading">
                        <strong>Test outputs</strong>
                        <span>{group.outputs.length} individual {group.outputs.length === 1 ? "image" : "images"}</span>
                      </div>
                      <div className="generation-output-strip">
                        {group.outputs.map((output) => (
                          <button
                            className="generation-output-tile"
                            type="button"
                            key={output.id}
                            onClick={() => setRenderedPreview({
                              imageUrl: output.imageUrl,
                              title: output.title,
                              label: "Test output",
                              promptType: "Test image",
                              storyStyle: topicStyleLabel(output.topicStyleId),
                              meta: `${output.model} · ${dateLabel(output.createdAt)}`,
                              costUsd: output.costUsd,
                              reference: group.reference,
                            })}
                          >
                            <span><ReliableImage src={output.imageUrl} alt={output.title} fill sizes="180px" fallbackLabel="Generated image unavailable" /><b className="generation-cost-chip">{generationCostLabel(output.costUsd)}</b></span>
                            <strong>{output.title}</strong>
                            <small>{generationCostLabel(output.costUsd)} · {topicStyleLabel(output.topicStyleId)}</small>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {group.carousels.map((carousel) => (
                    <section className="generation-carousel-set" key={carousel.id}>
                      <div className="generation-carousel-heading">
                        <div>
                          <span>Carousel set</span>
                          <strong>{carousel.name}</strong>
                          <small>{carousel.subject}</small>
                        </div>
                        <div>
                          <span className={`generation-status ${carousel.status}`}>{carousel.status.replace("_", " ")}</span>
                          <small>{carousel.productAssets.length > 0 ? `${carousel.productAssets.filter((asset) => asset.status === "approved").length}/${carousel.productAssets.length} authentic products approved` : `Prompt: carousel slide · ${topicStyleLabel(carousel.topicStyleId)}`} · {carousel.targetBrand} · {dateLabel(carousel.createdAt)}</small>
                        </div>
                      </div>
                      <div className="generation-slide-strip">
                        {carousel.slides.map((slide) => (
                          slide.imageUrl ? (
                            <button
                              type="button"
                              className="generation-slide-tile"
                              key={slide.id}
                              onClick={() => setRenderedPreview({
                                imageUrl: slide.imageUrl!,
                                title: `${carousel.name} · Slide ${slide.position}`,
                                label: "Carousel slide",
                                promptType: "Carousel slide",
                                storyStyle: topicStyleLabel(carousel.topicStyleId),
                                meta: `${slide.status} · ${dateLabel(carousel.createdAt)}`,
                                costUsd: slide.costUsd,
                                reference: group.reference,
                              })}
                            >
                              <span><ReliableImage src={slide.imageUrl} alt={`${carousel.name}, slide ${slide.position}`} fill sizes="160px" fallbackLabel="Slide image unavailable" /><b className="generation-cost-chip">{generationCostLabel(slide.costUsd)}</b></span>
                              <strong>Slide {slide.position}</strong>
                              <small>{generationCostLabel(slide.costUsd)} · {slide.status}</small>
                            </button>
                          ) : (
                            <div className={`generation-slide-tile empty ${slide.status}`} key={slide.id}>
                              <span><b>{slide.position}</b></span>
                              <strong>Slide {slide.position}</strong>
                              <small>{slide.status}</small>
                            </div>
                          )
                        ))}
                      </div>
                    </section>
                  ))}

                  {outputCount === 0 && group.carousels.length === 0 && (
                    <div className="generation-reference-empty">
                      <span aria-hidden="true">✦</span>
                      <div><strong>No rendered slides yet</strong><small>This reference has analysis data but no generated images.</small></div>
                    </div>
                  )}
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      {library && groups.length === 0 && (
        <div className="generation-empty">
          <span aria-hidden="true">✦</span>
          <h2>No saved outputs yet</h2>
          <p>References and their generated slides will appear here.</p>
        </div>
      )}

      <AnimatePresence>
        {analysisPreview && (
          <motion.div
            className="preview-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`${analysisPreview.title} from ${analysisPreview.creatorName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setAnalysisPreview(null);
            }}
          >
            <motion.div className="preview-dialog generation-preview-dialog" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}>
              <button type="button" className="preview-close" onClick={() => setAnalysisPreview(null)} aria-label="Close report">×</button>
              <div className="preview-media">
                <ReliableImage
                  src={analysisPreview.mediaType === "video" ? analysisPreview.thumbnailUrl : analysisPreview.mediaUrl}
                  alt={analysisPreview.mediaType === "video" ? `Video thumbnail from ${analysisPreview.creatorName}` : `Reference from ${analysisPreview.creatorName}`}
                  fill
                  sizes="min(90vw, 720px)"
                  fallbackLabel="Reference preview unavailable"
                />
              </div>
              <div className="preview-details generation-report-details">
                <div><span className="testing-label">Reference analysis</span><strong>{analysisPreview.title}</strong><small>@{analysisPreview.creatorHandle} · {analysisPreview.platform}</small></div>
                <p className="generation-report-summary">{analysisPreview.analysis.summary}</p>
                <div className="generation-report-section"><strong>Visual direction</strong><dl><div><dt>Composition</dt><dd>{analysisPreview.analysis.visualStyle.composition}</dd></div><div><dt>Typography</dt><dd>{analysisPreview.analysis.visualStyle.typography}</dd></div><div><dt>Imagery</dt><dd>{analysisPreview.analysis.visualStyle.imagery}</dd></div></dl></div>
                <div className="generation-report-section"><strong>Content strategy</strong><dl><div><dt>Hook</dt><dd>{analysisPreview.analysis.contentStrategy.hook}</dd></div><div><dt>Pacing</dt><dd>{analysisPreview.analysis.contentStrategy.pacing}</dd></div><div><dt>CTA</dt><dd>{analysisPreview.analysis.contentStrategy.cta}</dd></div></dl></div>
                <div className="generation-report-section"><strong>Reusable patterns</strong><ul>{analysisPreview.analysis.reusablePatterns.map((pattern) => <li key={pattern}>{pattern}</li>)}</ul></div>
                <p className="analysis-footnote">{analysisPreview.model} · {analysisPreview.frameCount} {analysisPreview.frameCount === 1 ? "image" : "frames"} · {(analysisPreview.durationMs / 1000).toFixed(1)}s</p>
                {analysisPreview.mediaType === "video" && analysisPreview.sourcePostUrl && <a href={analysisPreview.sourcePostUrl} target="_blank" rel="noreferrer">Watch on {analysisPreview.platform} ↗</a>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renderedPreview && (
          <motion.div
            className="preview-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={renderedPreview.title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setRenderedPreview(null);
            }}
          >
            <motion.div className="finished-output-dialog" initial={{ opacity: 0, scale: 0.97, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
              <button type="button" className="preview-close" onClick={() => setRenderedPreview(null)} aria-label="Close generated image">×</button>
              <ReliableImage src={renderedPreview.imageUrl} alt={renderedPreview.title} fill sizes="min(90vw, 720px)" fallbackLabel="Generated image unavailable" />
              <div className="finished-output-overlay">
                <span className="testing-label">{renderedPreview.label}</span>
                <strong>{renderedPreview.title}</strong>
                <small>Prompt type: {renderedPreview.promptType}</small>
                <small>Story style: {renderedPreview.storyStyle}</small>
                <small>{renderedPreview.meta}</small>
                <div className="generation-preview-cost"><span>Image generation cost</span><strong>{generationCostLabel(renderedPreview.costUsd)}</strong></div>
                <button type="button" className="finished-output-tiktok-button" onClick={() => setTikTokPreview(renderedPreview)}>Send to TikTok</button>
                <span className="finished-output-source-preview">Original reference: @{renderedPreview.reference.creatorHandle}{renderedPreview.reference.caption ? ` · ${renderedPreview.reference.caption}` : ""}</span>
                {renderedPreview.reference.postUrl && <a href={renderedPreview.reference.postUrl} target="_blank" rel="noreferrer">Open original post ↗</a>}
                <button
                  type="button"
                  className="finished-output-reference-button"
                  onClick={() => setExpandedReference(renderedPreview.reference)}
                  aria-label="Expand original reference image"
                >
                  <ReliableImage className="finished-output-source-thumb" src={renderedPreview.reference.thumbnailUrl} alt="" width={64} height={64} fallbackLabel="Reference unavailable" />
                  <span>Expand reference</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tiktokPreview && (
          <TikTokPostComposer
            imageUrl={tiktokPreview.imageUrl}
            generatedTitle={tiktokPreview.title}
            onClose={() => setTikTokPreview(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expandedReference && (
          <motion.div
            className="preview-backdrop expanded-reference-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`Original reference from ${expandedReference.creatorName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setExpandedReference(null);
            }}
          >
            <motion.div className="expanded-reference-dialog" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
              <button type="button" className="preview-close" onClick={() => setExpandedReference(null)} aria-label="Close reference image">×</button>
              <ReliableImage src={expandedReference.mediaType === "video" ? expandedReference.thumbnailUrl : expandedReference.mediaUrl} alt={`Original reference from ${expandedReference.creatorName}`} fill sizes="min(92vw, 900px)" fallbackLabel="Reference image unavailable" />
              <div className="expanded-reference-caption">
                <strong>@{expandedReference.creatorHandle}</strong>
                <span>{expandedReference.caption?.trim() || "No source caption available."}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
