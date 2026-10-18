"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type ReliableImageProps = Omit<ImageProps, "src" | "onError"> & {
  src: string;
  fallbackLabel?: string;
};

function retryUrl(src: string) {
  return `${src}${src.includes("?") ? "&" : "?"}retry=1`;
}

export default function ReliableImage({ src, alt, fallbackLabel = "Image unavailable", className, ...props }: ReliableImageProps) {
  const [loadState, setLoadState] = useState({ src, attempt: 0, failed: false });
  const current = loadState.src === src ? loadState : { src, attempt: 0, failed: false };

  if (current.failed) {
    const fallbackStyle = props.fill
      ? undefined
      : {
          position: "relative" as const,
          inset: "auto",
          width: props.width,
          height: props.height,
          flex: "0 0 auto",
        };
    return (
      <span className={["reliable-image-fallback", className].filter(Boolean).join(" ")} style={fallbackStyle} role="img" aria-label={fallbackLabel}>
        <span aria-hidden="true">▧</span>
        <small>{fallbackLabel}</small>
      </span>
    );
  }

  return (
    <Image
      {...props}
      alt={alt}
      className={className}
      src={current.attempt === 0 ? src : retryUrl(src)}
      unoptimized
      onError={() => {
        setLoadState((previous) => {
          const active = previous.src === src ? previous : { src, attempt: 0, failed: false };
          return active.attempt === 0
            ? { ...active, attempt: 1 }
            : { ...active, failed: true };
        });
      }}
    />
  );
}
