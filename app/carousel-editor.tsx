"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { CarouselSet } from "../lib/reference-types";
import { useWorkflowStore } from "./workflow-store";

export default function CarouselEditor({ topicStyleId, topicStyleName }: { topicStyleId: string; topicStyleName: string }) {
  const carousel = useWorkflowStore((state) => state.carousel);
  const setCarouselDraft = useWorkflowStore((state) => state.setCarouselDraft);
  const [session, setSession] = useState<CarouselSet | null>(null);
  const [slideCount, setSlideCount] = useState(carousel.slideCount);
  const [instruction, setInstruction] = useState("");
  const [name, setName] = useState("Untitled carousel");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => session?.slides.find((slide) => slide.position === (carousel.currentSlide || 1)) ?? session?.slides[0], [session, carousel.currentSlide]);
  const anchorUrl = carousel.anchorReferenceId ? `/api/references/${encodeURIComponent(carousel.anchorReferenceId)}/media?kind=thumbnail` : null;

  useEffect(() => {
    if (!carousel.carouselId) return;
    void fetch(`/api/carousels/${encodeURIComponent(carousel.carouselId)}`, { cache: "no-store" }).then((response) => response.json()).then(setSession).catch(() => setMessage("Saved carousel could not be restored."));
  }, [carousel.carouselId]);

  async function start() {
    if (!carousel.anchorReferenceId) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/carousels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, anchorReferenceId: carousel.anchorReferenceId, topicStyleId, slideCount, subject: carousel.subject }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Carousel could not be created.");
      setSession(payload); setCarouselDraft({ carouselId: payload.id, slideCount });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Carousel could not be created."); }
    finally { setBusy(false); }
  }

  async function generate() {
    if (!session || !current) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/carousels/${session.id}/slides/${current.position}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Slide generation failed.");
      setSession(payload); setInstruction("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Slide generation failed."); }
    finally { setBusy(false); }
  }

  async function keep() {
    if (!session || !current) return;
    const response = await fetch(`/api/carousels/${session.id}/slides/${current.position}/keep`, { method: "POST" });
    const payload = await response.json();
    if (response.ok) { setSession(payload); setCarouselDraft({ currentSlide: Math.min(current.position + 1, session.slideCount) }); }
  }

  if (!session) return (
    <section className="carousel-editor-screen">
      <p className="eyebrow">Carousel builder</p><h1>Build around your anchor</h1>
      <p className="supporting-copy">Every slide will be newly generated with the selected reference as its visual anchor.</p>
      {anchorUrl && <Image className="carousel-anchor-preview" src={anchorUrl} alt="Selected anchor" width={220} height={280} unoptimized />}
      <label className="carousel-field">Carousel name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="carousel-field">Slides<select value={slideCount} onChange={(event) => setSlideCount(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count} slides</option>)}</select></label>
      <p className="carousel-context">Style: <strong>{topicStyleName}</strong><br />Subject inferred from the reference caption.</p>
      {message && <div className="reference-alert" role="alert">{message}</div>}
      <button type="button" className="primary-button" disabled={busy || !carousel.anchorReferenceId} onClick={() => void start()}>{busy ? "Preparing…" : "Start carousel"}<span>→</span></button>
    </section>
  );

  return (
    <section className="carousel-editor-screen">
      <header className="carousel-editor-header"><p className="eyebrow">{session.name}</p><h1>Slide {current?.position} of {session.slideCount}</h1><p className="supporting-copy">{topicStyleName} · {session.status === "completed" ? "Carousel complete" : "Review, revise, and keep each slide"}</p></header>
      <div className="carousel-live-preview">
        {current?.imageUrl ? <Image src={current.imageUrl} alt={`Slide ${current.position}`} fill sizes="(max-width: 700px) 90vw, 520px" unoptimized /> : <div className="carousel-preview-empty">{busy ? "Generating your slide…" : "Your next slide will appear here"}</div>}
      </div>
      <div className="carousel-slide-strip">{session.slides.map((slide) => <button key={slide.id} type="button" className={slide.id === current?.id ? "active" : ""} onClick={() => setCarouselDraft({ currentSlide: slide.position })}><span>{slide.position}</span><small>{slide.status}</small></button>)}</div>
      {message && <div className="reference-alert" role="alert">{message}</div>}
      {current && session.status !== "completed" && <div className="carousel-controls"><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Optional change: make the hook bolder, simplify the text, shift the palette…" /><div><button type="button" className="secondary-button" disabled={busy} onClick={() => void generate()}>{current.status === "generated" || current.status === "kept" ? "Retry slide" : "Generate slide"}</button><button type="button" className="primary-button" disabled={busy || current.status !== "generated"} onClick={() => void keep()}>Keep & continue <span>→</span></button></div></div>}
      {session.status === "completed" && <div className="reference-success">Carousel saved in Generations.</div>}
    </section>
  );
}
