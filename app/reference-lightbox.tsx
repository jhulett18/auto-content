"use client";

import { useMemo } from "react";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import type {
  ReferenceAnalysisResponse,
  ReferenceAsset,
} from "../lib/reference-types";

type ReferenceLightboxProps = {
  asset: ReferenceAsset | null;
  analysis?: ReferenceAnalysisResponse;
  analysisError?: string | null;
  analyzing?: boolean;
  isSelected?: boolean;
  saving?: boolean;
  generating?: boolean;
  topicStyleId?: string | null;
  selectionEnabled?: boolean;
  onClose: () => void;
  onAnalyze?: (asset: ReferenceAsset) => void;
  onToggleSelection?: (asset: ReferenceAsset) => void;
  onGenerate?: (asset: ReferenceAsset) => void;
};

function compactNumber(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function ReferenceLightbox({
  asset,
  analysis,
  analysisError,
  analyzing = false,
  isSelected = false,
  saving = false,
  generating = false,
  topicStyleId,
  selectionEnabled = false,
  onClose,
  onAnalyze,
  onToggleSelection,
  onGenerate,
}: ReferenceLightboxProps) {
  const slides = useMemo(() => {
    if (!asset) return [];

    const title = (
      <div className="post-preview-heading">
        <span>{asset.platform}</span>
        <strong>{asset.creatorName}</strong>
        <small>@{asset.creatorHandle}</small>
      </div>
    );
    const description = (
      <div className="post-preview-details">
        <p>{asset.caption?.trim() || "No caption available."}</p>
        <div className="post-preview-meta">
          {dateLabel(asset.publishedAt) && <span>{dateLabel(asset.publishedAt)}</span>}
          {asset.views !== null && <span>{compactNumber(asset.views)} views</span>}
          {asset.likes !== null && <span>{compactNumber(asset.likes)} likes</span>}
        </div>
        <div className="post-preview-actions">
          {asset.postUrl ? (
            <a href={asset.postUrl} target="_blank" rel="noreferrer">
              Preview original post <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <span className="post-link-unavailable">Original post link unavailable</span>
          )}
          {selectionEnabled && onToggleSelection && (
            <button
              type="button"
              disabled={saving}
              className={isSelected ? "selected" : ""}
              onClick={() => onToggleSelection(asset)}
            >
              {isSelected ? "✓ Selected" : "+ Choose reference"}
            </button>
          )}
          {onAnalyze && (
            <button type="button" disabled={analyzing} onClick={() => onAnalyze(asset)}>
              {analyzing
                ? asset.mediaType === "video"
                  ? "Sampling frames…"
                  : "Reading image…"
                : analysis
                  ? "Refresh visual report"
                  : "✦ Analyze with OpenAI"}
            </button>
          )}
          {topicStyleId && onGenerate && (
            <button type="button" disabled={generating} onClick={() => onGenerate(asset)}>
              {generating ? "Generating finished image…" : "Generate finished test image"}
            </button>
          )}
        </div>
        {analysisError && <p className="post-preview-error">{analysisError}</p>}
        {analysis && (
          <div className="post-preview-analysis">
            <strong>Visual report</strong>
            <p>{analysis.analysis.summary}</p>
            <small>{analysis.model} · {analysis.frameCount} {analysis.frameCount === 1 ? "image" : "frames"}</small>
          </div>
        )}
      </div>
    );

    return asset.mediaType === "video"
      ? [
          {
            type: "video" as const,
            poster: asset.thumbnailUrl,
            sources: [{ src: asset.mediaUrl, type: "video/mp4" }],
            controls: true,
            playsInline: true,
            preload: "metadata",
            title,
            description,
          },
        ]
      : [
          {
            src: asset.mediaUrl,
            alt: `Post by ${asset.creatorName}`,
            imageFit: "contain" as const,
            title,
            description,
          },
        ];
  }, [
    analysis,
    analysisError,
    analyzing,
    asset,
    isSelected,
    onAnalyze,
    onToggleSelection,
    saving,
    selectionEnabled,
    generating,
    topicStyleId,
    onGenerate,
  ]);

  return (
    <Lightbox
      open={Boolean(asset)}
      close={onClose}
      slides={slides}
      plugins={[Video, Captions, Zoom]}
      className="reference-lightbox"
      carousel={{ finite: true, preload: 0, padding: "24px", imageFit: "contain" }}
      captions={{ descriptionTextAlign: "start", descriptionMaxLines: 12, showToggle: true }}
      video={{ controls: true, playsInline: true, preload: "metadata" }}
      controller={{ closeOnBackdropClick: true }}
      toolbar={{ buttons: ["captions", "close"] }}
      animation={{ fade: 180, swipe: 220 }}
      styles={{ container: { backgroundColor: "rgba(5, 5, 8, 0.96)" } }}
      labels={{ Close: "Close post preview" }}
    />
  );
}
