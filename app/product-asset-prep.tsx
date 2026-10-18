"use client";

import Image from "next/image";
import { useState } from "react";
import type { CarouselSet, ProductMaskRegion } from "../lib/reference-types";

type Props = { session: CarouselSet; onChange: (session: CarouselSet) => void };

export default function ProductAssetPrep({ session, onChange }: Props) {
  const [masks, setMasks] = useState<Record<string, ProductMaskRegion[]>>(() => Object.fromEntries(session.productAssets.map((asset) => [asset.id, asset.masks])));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(assetId: string, file: File | null) {
    if (!file) return;
    setBusyId(assetId); setError(null);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch(`/api/carousels/${session.id}/products/${assetId}/upload`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Product upload failed.");
      setMasks(Object.fromEntries((payload as CarouselSet).productAssets.map((asset) => [asset.id, asset.masks])));
      onChange(payload);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Product upload failed."); }
    finally { setBusyId(null); }
  }

  async function approve(assetId: string) {
    setBusyId(assetId); setError(null);
    try {
      const response = await fetch(`/api/carousels/${session.id}/products/${assetId}/mask`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ regions: masks[assetId] ?? [] }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Mask approval failed.");
      setMasks(Object.fromEntries((payload as CarouselSet).productAssets.map((asset) => [asset.id, asset.masks])));
      onChange(payload);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Mask approval failed."); }
    finally { setBusyId(null); }
  }

  function updateRegion(assetId: string, regionId: string, field: "x"|"y"|"width"|"height", value: number) {
    setMasks((current) => ({ ...current, [assetId]: (current[assetId] ?? []).map((region) => region.id === regionId ? { ...region, [field]: Math.max(0, Math.min(1, value)) } : region) }));
  }

  function addRegion(assetId: string) {
    setMasks((current) => ({ ...current, [assetId]: [...(current[assetId] ?? []), { id: crypto.randomUUID(), kind: "other", label: "Manual trademark cover", x: .2, y: .2, width: .6, height: .25 }] }));
  }

  function removeRegion(assetId: string, regionId: string) {
    setMasks((current) => ({ ...current, [assetId]: (current[assetId] ?? []).filter((region) => region.id !== regionId) }));
  }

  return (
    <section className="product-prep">
      <header><p className="eyebrow">Authentic product preparation</p><h2>Approve all three product photos</h2><p>Official pages are checked first. When a page blocks server access, upload an approved photo. Vision proposes trademark covers; you remain in control of every region.</p></header>
      {error && <div className="reference-alert" role="alert">{error}</div>}
      <div className="product-prep-grid">
        {session.productAssets.map((asset) => {
          const regions = masks[asset.id] ?? asset.masks;
          const imageUrl = asset.status === "approved" ? asset.preparedImageUrl : asset.originalImageUrl;
          return (
            <article className={`product-prep-card ${asset.status}`} key={asset.id}>
              <div className="product-prep-heading"><div><strong>{asset.label}</strong><small>SKU {asset.sku} · limit {asset.limit}</small></div><span>{asset.status.replace("_", " ")}</span></div>
              {imageUrl ? (
                <div className="product-mask-canvas">
                  <Image src={imageUrl} alt={`${asset.label} product source`} fill sizes="(max-width: 800px) 90vw, 280px" unoptimized />
                  {asset.status !== "approved" && regions.map((region) => <span key={region.id} title={region.label} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />)}
                </div>
              ) : <div className="product-upload-placeholder">Official image unavailable</div>}
              {asset.sourcePageUrl && <a href={asset.sourcePageUrl} target="_blank" rel="noreferrer">Open official SKU page ↗</a>}
              {asset.error && <p className="product-error">{asset.error}</p>}
              {asset.status !== "approved" && <label className="product-upload">{busyId === asset.id ? "Preparing image…" : "Upload approved photo"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busyId)} onChange={(event) => void upload(asset.id, event.target.files?.[0] ?? null)} /></label>}
              {asset.status === "mask_review" && (
                <div className="mask-editor">
                  <div className="mask-editor-title"><strong>Trademark covers</strong><button type="button" onClick={() => addRegion(asset.id)}>+ Add region</button></div>
                  {regions.map((region) => (
                    <div className="mask-row" key={region.id}>
                      <span>{region.label}</span>
                      {(["x","y","width","height"] as const).map((field) => <label key={field}>{field[0].toUpperCase()}<input type="number" min="0" max="1" step="0.01" value={region[field]} onChange={(event) => updateRegion(asset.id, region.id, field, Number(event.target.value))} /></label>)}
                      <button type="button" aria-label={`Remove ${region.label}`} onClick={() => removeRegion(asset.id, region.id)}>×</button>
                    </div>
                  ))}
                  <button type="button" className="primary-button mask-approve" disabled={busyId === asset.id || regions.length === 0} onClick={() => void approve(asset.id)}>{busyId === asset.id ? "Applying…" : "Approve branded covers"}</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
