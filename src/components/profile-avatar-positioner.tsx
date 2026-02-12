"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { cn } from "@/lib/utils";

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function computeCoverOverflow(input: {
  containerWidth: number;
  containerHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}) {
  const cw = input.containerWidth;
  const ch = input.containerHeight;
  const iw = input.naturalWidth;
  const ih = input.naturalHeight;
  if (!cw || !ch || !iw || !ih) return null;

  const scale = Math.max(cw / iw, ch / ih);
  const rw = iw * scale;
  const rh = ih * scale;
  return { overflowX: Math.max(0, rw - cw), overflowY: Math.max(0, rh - ch) };
}

export function ProfileAvatarPositioner(props: {
  name: string;
  src: string | null;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  disabled?: boolean;
  sizePx?: number;
  className?: string;
  "data-testid"?: string;
}) {
  const sizePx = props.sizePx ?? 96;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPos: { x: number; y: number };
    overflowX: number;
    overflowY: number;
  } | null>(null);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopDrag();
  }, [stopDrag]);

  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (props.disabled) return;
      if (!props.src) return;
      if (e.button !== 0) return;
      if (!containerRef.current || !imgRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const overflow = computeCoverOverflow({
        containerWidth: rect.width,
        containerHeight: rect.height,
        naturalWidth: imgRef.current.naturalWidth,
        naturalHeight: imgRef.current.naturalHeight,
      });
      if (!overflow) return;

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPos: props.position,
        overflowX: overflow.overflowX,
        overflowY: overflow.overflowY,
      };

      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [props.disabled, props.position, props.src]
  );

  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      if (!props.src) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      const x =
        drag.overflowX > 0
          ? clampPct(drag.startPos.x - (dx / drag.overflowX) * 100)
          : 50;
      const y =
        drag.overflowY > 0
          ? clampPct(drag.startPos.y - (dy / drag.overflowY) * 100)
          : 50;

      props.onPositionChange({ x, y });
    },
    [props.onPositionChange, props.src]
  );

  const onEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (e.pointerId !== drag.pointerId) return;
      stopDrag();
    },
    [stopDrag]
  );

  if (!props.src) {
    return (
      <ProfileAvatar
        className={props.className}
        name={props.name}
        sizePx={sizePx}
        src={null}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative touch-none select-none overflow-hidden rounded-full bg-muted ring-1 ring-border",
        props.disabled ? "opacity-70" : "cursor-grab active:cursor-grabbing",
        props.className
      )}
      data-testid={props["data-testid"]}
      onPointerCancel={onEnd}
      onPointerDown={startDrag}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      ref={containerRef}
      style={{ width: sizePx, height: sizePx }}
    >
      <img
        alt={props.name}
        className="h-full w-full object-cover"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        ref={imgRef}
        src={props.src}
        style={{ objectPosition: `${props.position.x}% ${props.position.y}%` }}
      />
    </div>
  );
}
