"use client";

import { cn } from "@/lib/utils";

export type ReadinessDotState =
  | "untested"
  | "testing"
  | "passed"
  | "failed"
  | "disabled"
  | "blocked"
  | "not_applicable";

export function ReadinessDot(props: {
  state: ReadinessDotState;
  className?: string;
}) {
  const state = props.state;
  const isBlinking = state === "testing";
  const color =
    state === "passed"
      ? "bg-emerald-500"
      : state === "disabled" || state === "blocked" || state === "not_applicable"
        ? "bg-muted-foreground/40"
        : "bg-red-500";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        color,
        isBlinking ? "animate-[readiness-blink_1s_linear_infinite]" : "",
        props.className
      )}
    />
  );
}

