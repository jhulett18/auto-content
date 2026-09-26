"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type {
  GenerationItem,
  GenerationLibraryResponse,
  GenerationOutput,
} from "../lib/reference-types";

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function priceLabel(model: string) {
  if (model.startsWith("gpt-image-2.5")) return "$8 input / $30 output per 1M image tokens";
  if (model.startsWith("gpt-image-2")) return "$4 input / $15 output per 1M image tokens";
  return "Usage-based OpenAI image pricing";
}

export default function GenerationLibrary() {
  const [library, setLibrary] = useState<GenerationLibraryResponse | null>(null);
  const [preview, setPreview] = useState<GenerationItem | null>(null);
  const [outputPreview, setOutputPreview] = useState<GenerationOutput | null>(null);
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
    if (!preview && !outputPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
    };
  }, [outputPreview, preview]);

  return (
    <motion.section
      className="generation-library-screen"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
    >
      <header className="generation-header">
        <p className="eyebrow">Generation library</p>
        <h1>Your creative outputs</h1>
        <p className="supporting-copy">
          Review saved experiments and future slide collections in one place.
        </p>
      </header>

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

      {library?.collections.map((collection) => (
        <article key={collection.id} className="generation-collection">
          <div className="generation-collection-heading">
            <div>
              <span className="testing-label">{collection.label}</span>
              <h2>Analysis showcase</h2>
              <p>
                The saved OpenAI output from the image and video vision tests.
                These are reference reports, not rendered carousel slides yet.
              </p>
            </div>
            <div className="collection-meta">
              <strong>{collection.items.length + collection.outputs.length}</strong>
              <span>test outputs</span>
              <small>{dateLabel(collection.createdAt)}</small>
            </div>
          </div>

          <div className="generation-grid">
            {collection.items.map((item, index) => (
              <motion.button
                key={item.id}
                type="button"
                className="generation-card"
                onClick={() => setPreview(item)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
              >
                <span className="generation-card-media">
                  <Image src={item.thumbnailUrl} alt="" fill sizes="(max-width: 640px) 90vw, 320px" unoptimized />
                  <span className="media-shade" />
                  <span className="platform-pill">{item.platform}</span>
                  <span className="media-kind-pill">
                    {item.mediaType === "video" ? `${item.frameCount} frames` : "1 image"}
                  </span>
                </span>
                <span className="generation-card-copy">
                  <span>
                    <strong>{item.title}</strong>
                    <small>@{item.creatorHandle}</small>
                  </span>
                  <p>{item.analysis.summary}</p>
                  <span className="generation-card-footer">
                    <span>{item.model}</span><span>Open report →</span>
                  </span>
                </span>
              </motion.button>
            ))}
          </div>

          {collection.outputs.length > 0 && (
            <div className="finished-output-section">
              <div className="finished-output-heading">
                <div>
                  <span className="testing-label">Finished image</span>
                  <h3>Generated with the selected topic style</h3>
                </div>
                <small>{collection.outputs.length} saved image{collection.outputs.length === 1 ? "" : "s"}</small>
              </div>
              <div className="finished-output-grid">
                {collection.outputs.map((output) => (
                  <motion.button
                    key={output.id}
                    type="button"
                    className="finished-output-card"
                    onClick={() => setOutputPreview(output)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <span className="finished-output-media">
                      <Image src={output.imageUrl} alt={output.title} fill sizes="(max-width: 640px) 80vw, 250px" unoptimized />
                    </span>
                    <span className="finished-output-copy">
                      <strong>{output.title}</strong>
                      <small>@{output.creatorHandle} · {output.model}</small>
                      <small className="finished-output-source">Original reference · {output.platform}</small>
                      <small className="finished-output-price">Price: {priceLabel(output.model)}</small>
                      <span>Open finished image →</span>
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>
          )}
        </article>
      ))}

      {(library?.carousels?.length ?? 0) > 0 && (
        <section className="saved-carousel-section">
          <div className="finished-output-heading"><div><span className="testing-label">Carousel sets</span><h2>Anchor-led carousels</h2></div></div>
          <div className="saved-carousel-grid">
            {library?.carousels?.map((carousel) => {
              const first = carousel.slides.find((slide) => slide.imageUrl);
              return <article className="saved-carousel-card" key={carousel.id}>
                <div className="saved-carousel-media">{first?.imageUrl ? <Image src={first.imageUrl} alt={carousel.name} fill sizes="220px" unoptimized /> : <span>In progress</span>}</div>
                <div><strong>{carousel.name}</strong><small>{carousel.slides.filter((slide) => slide.status === "kept").length} / {carousel.slideCount} slides kept · {carousel.status}</small><small>Anchor-led · {carousel.topicStyleId}</small></div>
              </article>;
            })}
          </div>
        </section>
      )}

      {library && library.collections.length === 0 && (
        <div className="generation-empty">
          <span aria-hidden="true">✦</span>
          <h2>No saved outputs yet</h2>
          <p>Completed analysis and slide collections will appear here.</p>
        </div>
      )}

      <AnimatePresence>
        {preview && (
          <motion.div
            className="preview-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`${preview.title} from ${preview.creatorName}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setPreview(null);
            }}
          >
            <motion.div
              className="preview-dialog generation-preview-dialog"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
            >
              <button type="button" className="preview-close" onClick={() => setPreview(null)} aria-label="Close report">×</button>
              <div className="preview-media">
                {preview.mediaType === "video" ? (
                  <video src={preview.mediaUrl} poster={preview.thumbnailUrl} controls playsInline preload="metadata" />
                ) : (
                  <Image src={preview.mediaUrl} alt={`Testing reference from ${preview.creatorName}`} fill sizes="min(90vw, 720px)" unoptimized />
                )}
              </div>
              <div className="preview-details generation-report-details">
                <div>
                  <span className="testing-label">Testing</span>
                  <strong>{preview.title}</strong>
                  <small>@{preview.creatorHandle} · {preview.platform}</small>
                </div>
                <p className="generation-report-summary">{preview.analysis.summary}</p>
                <div className="generation-report-section">
                  <strong>Visual direction</strong>
                  <dl>
                    <div><dt>Composition</dt><dd>{preview.analysis.visualStyle.composition}</dd></div>
                    <div><dt>Typography</dt><dd>{preview.analysis.visualStyle.typography}</dd></div>
                    <div><dt>Imagery</dt><dd>{preview.analysis.visualStyle.imagery}</dd></div>
                  </dl>
                </div>
                <div className="generation-report-section">
                  <strong>Content strategy</strong>
                  <dl>
                    <div><dt>Hook</dt><dd>{preview.analysis.contentStrategy.hook}</dd></div>
                    <div><dt>Pacing</dt><dd>{preview.analysis.contentStrategy.pacing}</dd></div>
                    <div><dt>CTA</dt><dd>{preview.analysis.contentStrategy.cta}</dd></div>
                  </dl>
                </div>
                <div className="generation-report-section">
                  <strong>Reusable patterns</strong>
                  <ul>{preview.analysis.reusablePatterns.map((pattern) => <li key={pattern}>{pattern}</li>)}</ul>
                </div>
                <p className="analysis-footnote">
                  {preview.model} · {preview.frameCount} {preview.frameCount === 1 ? "image" : "frames"} · {(preview.durationMs / 1000).toFixed(1)}s
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {outputPreview && (
          <motion.div
            className="preview-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={outputPreview.title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOutputPreview(null);
            }}
          >
            <motion.div className="finished-output-dialog" initial={{ opacity: 0, scale: 0.97, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
              <button type="button" className="preview-close" onClick={() => setOutputPreview(null)} aria-label="Close generated image">×</button>
              <Image src={outputPreview.imageUrl} alt={outputPreview.title} fill sizes="min(90vw, 720px)" unoptimized />
              <div className="finished-output-overlay">
                <span className="testing-label">Testing</span>
                <strong>{outputPreview.title}</strong>
                <small>{outputPreview.model} · topic style: {outputPreview.topicStyleId}</small>
                <small>Price: {priceLabel(outputPreview.model)}</small>
                <span className="finished-output-source-preview">
                  Original reference: @{outputPreview.creatorHandle}
                  {outputPreview.sourceCaption ? ` · ${outputPreview.sourceCaption}` : ""}
                </span>
                {outputPreview.sourcePostUrl && <a href={outputPreview.sourcePostUrl} target="_blank" rel="noreferrer">Open original post ↗</a>}
                <Image className="finished-output-source-thumb" src={outputPreview.sourceThumbnailUrl} alt="Original reference used" width={64} height={64} unoptimized />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
