import React, { useState } from "react";
import { resolveCountryCode } from "@/lib/format";

export const FlagIcon: React.FC<{
  region?: string | null;
  size?: number;
}> = React.memo(({ region, size = 22 }) => {
  const code = resolveCountryCode(region);
  const [fallback, setFallback] = useState(false);
  const height = Math.round(size * 0.75);

  return (
    <span
      style={{
        display: "inline-flex",
        width: size,
        height,
        borderRadius: 4,
        overflow: "hidden",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 0 1px rgba(128, 128, 150, 0.18)",
      }}
      title={code}
    >
      <img
        src={fallback ? "/flags/UN.svg" : `/flags/${code}.svg`}
        alt={code}
        width={size}
        height={height}
        loading="lazy"
        decoding="async"
        onError={() => {
          if (!fallback) setFallback(true);
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </span>
  );
});

FlagIcon.displayName = "FlagIcon";
