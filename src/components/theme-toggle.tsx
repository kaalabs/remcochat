"use client";

import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const requestComposerFocus = () => {
    window.dispatchEvent(new Event("remcochat:focus-composer"));
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!mounted) return;

      const key = e.key.toLowerCase();
      if (key !== "l") return;
      if (!e.shiftKey) return;
      if (!e.metaKey && !e.ctrlKey) return;

      e.preventDefault();
      const isDark = resolvedTheme === "dark";
      setTheme(isDark ? "light" : "dark");
      requestComposerFocus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, resolvedTheme, setTheme]);

  if (!mounted) {
    return (
      <Button
        aria-label="Toggle theme"
        className="h-8 w-8"
        size="icon"
        variant="ghost"
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      aria-label="Toggle theme"
      className="h-8 w-8"
      onClick={() => {
        setTheme(isDark ? "light" : "dark");
        requestComposerFocus();
      }}
      size="icon"
      variant="ghost"
    >
      {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
}
