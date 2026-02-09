"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n-provider";
import { useState } from "react";

type StaticMapPreviewProps = {
  latitude: number;
  longitude: number;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
};

export function StaticMapPreview(props: StaticMapPreviewProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        aria-label={props.alt}
        className={cn(
          props.className,
          "flex items-center justify-center bg-muted/30 text-xs text-muted-foreground"
        )}
      >
        {t("map.preview.unavailable")}
      </div>
    );
  }

  const src = `/api/static-map?lat=${encodeURIComponent(
    String(props.latitude)
  )}&lon=${encodeURIComponent(String(props.longitude))}&zoom=12&w=400&h=150`;

  return (
    <img
      src={src}
      alt={props.alt}
      className={props.className}
      loading={props.loading}
      onError={() => setFailed(true)}
    />
  );
}
