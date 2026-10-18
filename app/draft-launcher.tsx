"use client";

import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import GenerationLibrary from "./generation-library";
import CarouselEditor from "./carousel-editor";
import ReferencePicker from "./reference-picker";
import { TOPIC_STYLES } from "./topic-styles";
import {
  type DraftPath,
  type DraftResult,
  useWorkflowStore,
} from "./workflow-store";

export type AppScreen =
  | "home"
  | "loading"
  | "result"
  | "topic-style"
  | "references"
  | "carousel"
  | "reference-library"
  | "generations";

const screenMotion = {
  initial: { opacity: 0, y: 18, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -14, filter: "blur(7px)" },
  transition: { duration: 0.32, ease: "easeOut" as const },
};

function fallbackFailure(): DraftResult {
  return {
    success: false,
    summary: "The draft could not be started.",
    durationMs: 0,
    checks: [
      {
        label: "Application request",
        status: "fail",
        detail: "The browser did not receive a valid diagnostic response.",
      },
    ],
  };
}

export default function DraftLauncher({ screen }: { screen: AppScreen }) {
  const router = useRouter();
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  const [activeStyleIndex, setActiveStyleIndex] = useState(0);
  const stylePickerRef = useRef<HTMLDivElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const requestInFlight = useRef(false);
  const result = useWorkflowStore((state) => state.result);
  const selectedStyleId = useWorkflowStore((state) => state.selectedStyleId);
  const selectedContextKey = useWorkflowStore((state) => state.selectedContextKey);
  const hasActiveDraft = useWorkflowStore((state) => state.hasActiveDraft);
  const updatedAt = useWorkflowStore((state) => state.updatedAt);
  const lastDraftPath = useWorkflowStore((state) => state.lastDraftPath);
  const hydrated = useWorkflowStore((state) => state.hydrated);
  const beginDraft = useWorkflowStore((state) => state.beginDraft);
  const completeInitialization = useWorkflowStore(
    (state) => state.completeInitialization,
  );
  const setSelectedStyleId = useWorkflowStore(
    (state) => state.setSelectedStyleId,
  );
  const setSelectedContextKey = useWorkflowStore((state) => state.setSelectedContextKey);
  const setHydrated = useWorkflowStore((state) => state.setHydrated);
  const markDraftPath = useWorkflowStore((state) => state.markDraftPath);
  const carouselAnchorId = useWorkflowStore((state) => state.carousel.anchorReferenceId);

  const selectedStyle = TOPIC_STYLES.find(
    (style) => style.id === selectedStyleId,
  );
  const previewStyle = isStyleMenuOpen
    ? TOPIC_STYLES[activeStyleIndex]
    : (selectedStyle ?? TOPIC_STYLES[activeStyleIndex]);

  useEffect(() => {
    const unsubscribe = useWorkflowStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    void Promise.resolve(useWorkflowStore.persist.rehydrate()).then(() =>
      setHydrated(true),
    );
    return unsubscribe;
  }, [setHydrated]);

  useEffect(() => {
    if (!isStyleMenuOpen) return;

    function handleOutsidePress(event: PointerEvent) {
      if (!stylePickerRef.current?.contains(event.target as Node)) {
        setIsStyleMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsidePress);
    return () => document.removeEventListener("pointerdown", handleOutsidePress);
  }, [isStyleMenuOpen]);

  async function loadDraftContext() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const controller = new AbortController();
    requestController.current = controller;

    try {
      const response = await fetch("/api/drafts/start", {
        method: "POST",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      completeInitialization(
        payload && typeof payload === "object"
          ? (payload as DraftResult)
          : fallbackFailure(),
      );
      router.replace("/draft/result");
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        completeInitialization(fallbackFailure());
      }
    } finally {
      requestInFlight.current = false;
      requestController.current = null;
    }
  }

  useEffect(() => {
    if (hydrated && screen === "loading" && !requestInFlight.current) {
      void loadDraftContext();
    }
  // loadDraftContext intentionally reads stable store actions and refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, screen]);

  useEffect(() => {
    if (!hydrated) return;
    const pathByScreen: Partial<Record<AppScreen, DraftPath>> = {
      loading: "/draft/loading",
      result: "/draft/result",
      "topic-style": "/draft/topic-style",
      references: "/draft/references",
      carousel: "/draft/carousel",
    };
    const draftPath = pathByScreen[screen];
    if (draftPath && screen !== "loading") markDraftPath(draftPath);

    if (screen === "result" && !result) router.replace("/");
    if (screen === "topic-style" && !result?.success) router.replace("/");
    if (screen === "references" && !selectedStyleId) {
      router.replace("/draft/topic-style");
    }
    if (screen === "carousel" && (!selectedStyleId || !carouselAnchorId)) {
      router.replace("/draft/references");
    }
  }, [carouselAnchorId, hydrated, markDraftPath, result, router, screen, selectedStyleId]);

  function startDraft() {
    beginDraft();
    void fetch("/api/references", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    }).catch(() => undefined);
    router.push("/draft/loading");
  }

  function openStyleMenu() {
    const selectedIndex = TOPIC_STYLES.findIndex(
      (style) => style.id === selectedStyleId,
    );
    setActiveStyleIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsStyleMenuOpen(true);
  }

  function selectActiveStyle() {
    const style = TOPIC_STYLES[activeStyleIndex];
    setSelectedStyleId(style.id);
    setIsStyleMenuOpen(false);
  }

  function handleStylePickerKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isStyleMenuOpen) {
        openStyleMenu();
        return;
      }

      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveStyleIndex(
        (current) =>
          (current + direction + TOPIC_STYLES.length) % TOPIC_STYLES.length,
      );
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isStyleMenuOpen) {
      event.preventDefault();
      selectActiveStyle();
      return;
    }

    if (event.key === "Escape" && isStyleMenuOpen) {
      event.preventDefault();
      setIsStyleMenuOpen(false);
    }
  }

  if (!hydrated) {
    return (
      <main>
        <section className="screen loading-screen" aria-live="polite">
          <div className="loader" aria-hidden="true"><motion.span animate={{ rotate: 360 }} transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }} /><i /></div>
          <p className="eyebrow">Restoring workspace</p>
          <h1>Picking up where you left off</h1>
        </section>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main>
        {screen !== "home" && (
          <Link className="home-menu-button" href="/" onClick={() => requestController.current?.abort()}>
            <span aria-hidden="true">⌂</span> Home
          </Link>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {screen === "home" && (
            <motion.section key="home" className="screen start-screen home-screen" {...screenMotion}>
              <p className="eyebrow">Auto Content Studio</p>
              <h1>Your creative workspace</h1>
              <p className="supporting-copy">
                Start fresh, continue your saved flow, or browse what you have collected.
              </p>
              <motion.button
                type="button"
                className="primary-button"
                onClick={startDraft}
                whileHover={{ scale: 1.025 }}
                whileTap={{ scale: 0.97 }}
              >
                Start New Draft
                <span aria-hidden="true">→</span>
              </motion.button>
              {hasActiveDraft && (
                <Link className="resume-draft-button" href={lastDraftPath}>
                  <span><strong>Continue saved draft</strong><small>{updatedAt ? `Saved ${new Date(updatedAt).toLocaleString()}` : "Progress saved locally"}</small></span>
                  <span aria-hidden="true">↗</span>
                </Link>
              )}
              <div className="library-actions">
                <Link href="/references">
                  <span className="library-action-icon" aria-hidden="true">▧</span>
                  <span><strong>View references</strong><small>Browse the Apify media library</small></span>
                  <span aria-hidden="true">→</span>
                </Link>
                <Link href="/generations">
                  <span className="library-action-icon" aria-hidden="true">✦</span>
                  <span><strong>View generations</strong><small>See generated slide sets</small></span>
                  <span aria-hidden="true">→</span>
                </Link>
                <Link href="/automation">
                  <span className="library-action-icon" aria-hidden="true">↻</span>
                  <span><strong>Daily automation</strong><small>Review GFNF runs and schedules</small></span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </motion.section>
          )}

          {screen === "loading" && (
            <motion.section
              key="loading"
              className="screen loading-screen"
              aria-live="polite"
              {...screenMotion}
            >
              <div className="loader" aria-hidden="true">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                />
                <i />
              </div>
              <p className="eyebrow">Starting draft</p>
              <h1>Loading recent context</h1>
              <p className="supporting-copy">
                Fetching the latest 50 messages from Aletheia.
              </p>
            </motion.section>
          )}

          {screen === "result" && result && (
            <motion.section
              key="result"
              className="screen result-screen"
              aria-live="polite"
              {...screenMotion}
            >
              <div className={`status-mark ${result.success ? "success" : "failure"}`}>
                <motion.span
                  initial={{ scale: 0.4, rotate: -18 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 330, damping: 19 }}
                  aria-hidden="true"
                >
                  {result.success ? "✓" : "!"}
                </motion.span>
              </div>

              <p className="eyebrow">Draft initialization</p>
              <h1>{result.success ? "Context loaded" : "Load failed"}</h1>
              <p className="supporting-copy">{result.summary}</p>

              <div className="report">
                <div className="report-heading">
                  <span>Diagnostic report</span>
                  <span>{result.durationMs} ms</span>
                </div>
                <ul>
                  {result.checks.map((check) => (
                    <li key={check.label}>
                      <span className={`check-dot ${check.status}`} aria-hidden="true" />
                      <span>
                        <strong>{check.label}</strong>
                        <small>{check.detail}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {result.success && result.contextGroups && result.contextGroups.length > 0 && (
                <div className="context-picker">
                  <div className="report-heading"><span>GFNF source brief</span><span>Select one</span></div>
                  {result.contextGroups.slice(0, 12).map((group) => (
                    <button
                      type="button"
                      key={group.key}
                      className={selectedContextKey === group.key ? "selected" : ""}
                      onClick={() => setSelectedContextKey(group.key)}
                    >
                      <span><strong>{new Date(group.timestamp).toLocaleString()}</strong><small>{group.text || "Image attachment"}</small></span>
                      <span>{group.products.length > 0 ? `${group.products.length} products` : group.attachments.length > 0 ? `${group.attachments.length} image` : "message"}</span>
                    </button>
                  ))}
                </div>
              )}

              {result.success ? (
                <button
                  type="button"
                  className="primary-button result-action"
                  disabled={!selectedContextKey}
                  onClick={() => router.push("/draft/topic-style")}
                >
                  Continue
                  <span aria-hidden="true">→</span>
                </button>
              ) : (
                <button type="button" className="secondary-button" onClick={startDraft}>
                  Try again
                </button>
              )}
            </motion.section>
          )}

          {screen === "topic-style" && (
            <motion.section
              key="topic-style"
              className="screen style-screen"
              {...screenMotion}
            >
              <div className="whimsy-orbit orbit-one" aria-hidden="true" />
              <div className="whimsy-orbit orbit-two" aria-hidden="true" />

              <p className="eyebrow">Shape the story</p>
              <h1>Choose a topic style</h1>
              <p className="supporting-copy">
                Pick the storytelling lens that should guide this draft.
              </p>

              <div className="style-picker" ref={stylePickerRef}>
                <span id="topic-style-label" className="field-label">
                  Topic style
                </span>
                <button
                  type="button"
                  className={`style-trigger ${isStyleMenuOpen ? "open" : ""}`}
                  role="combobox"
                  aria-labelledby="topic-style-label"
                  aria-controls="topic-style-options"
                  aria-expanded={isStyleMenuOpen}
                  aria-activedescendant={
                    isStyleMenuOpen
                      ? `topic-style-${TOPIC_STYLES[activeStyleIndex].id}`
                      : undefined
                  }
                  aria-haspopup="listbox"
                  onClick={() =>
                    isStyleMenuOpen
                      ? setIsStyleMenuOpen(false)
                      : openStyleMenu()
                  }
                  onKeyDown={handleStylePickerKeyDown}
                >
                  <span className={selectedStyle ? "has-value" : "placeholder"}>
                    {selectedStyle?.name ?? "Select a storytelling style"}
                  </span>
                  <motion.span
                    className="chevron"
                    animate={{ rotate: isStyleMenuOpen ? 180 : 0 }}
                    aria-hidden="true"
                  >
                    ↓
                  </motion.span>
                </button>

                <AnimatePresence>
                  {isStyleMenuOpen && (
                    <motion.ul
                      id="topic-style-options"
                      className="style-options"
                      role="listbox"
                      aria-labelledby="topic-style-label"
                      initial={{ opacity: 0, y: -8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.985 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      {TOPIC_STYLES.map((style, index) => (
                        <motion.li
                          id={`topic-style-${style.id}`}
                          key={style.id}
                          role="option"
                          aria-selected={selectedStyleId === style.id}
                          className={`${
                            activeStyleIndex === index ? "active" : ""
                          } ${selectedStyleId === style.id ? "selected" : ""}`}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(index * 0.025, 0.18) }}
                          onPointerMove={() => setActiveStyleIndex(index)}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setActiveStyleIndex(index);
                            setSelectedStyleId(style.id);
                            setIsStyleMenuOpen(false);
                          }}
                        >
                          <span className="option-spark" aria-hidden="true">
                            ✦
                          </span>
                          <span>{style.name}</span>
                          <span className="option-check" aria-hidden="true">
                            {selectedStyleId === style.id ? "✓" : ""}
                          </span>
                        </motion.li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={previewStyle.id}
                  className="style-preview"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="preview-glyph" aria-hidden="true">
                    ✦
                  </span>
                  <div>
                    <span>Style preview</span>
                    <strong>{previewStyle.name}</strong>
                    <p>{previewStyle.description}</p>
                  </div>
                </motion.div>
              </AnimatePresence>

              {selectedStyle && (
                <motion.div
                  className="reference-next"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <button
                    type="button"
                    className="reference-button"
                    onClick={() => router.push("/draft/references")}
                  >
                    Continue to Reference
                    <span aria-hidden="true">→</span>
                  </button>
                  <small>Choose one image anchor in the next step.</small>
                </motion.div>
              )}
            </motion.section>
          )}

          {screen === "references" && selectedStyle && (
            <div key="references" className="reference-shell">
              <ReferencePicker
                topicStyleName={selectedStyle.name}
                topicStyleId={selectedStyle.id}
                mode="workflow"
                onBack={() => router.push("/draft/topic-style")}
                onStartCarousel={(anchor) => {
                  useWorkflowStore.getState().setCarouselAnchor(anchor.id, anchor.caption || "Original visual story");
                  router.push("/draft/carousel");
                }}
              />
            </div>
          )}

          {screen === "carousel" && selectedStyle && <CarouselEditor topicStyleId={selectedStyle.id} topicStyleName={selectedStyle.name} />}

          {screen === "reference-library" && (
            <div key="reference-library" className="reference-shell">
              <ReferencePicker mode="library" topicStyleId={selectedStyleId} />
            </div>
          )}

          {screen === "generations" && <GenerationLibrary key="generations" />}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}
