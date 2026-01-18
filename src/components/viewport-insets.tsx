"use client";

import { useEffect } from "react";

export function ViewportInsets() {
  useEffect(() => {
    const root = document.documentElement;

    const vv = window.visualViewport;
    if (!vv) {
      root.style.setProperty("--rc-keyboard-inset", "0px");
      return;
    }

    let rafId = 0;
    const update = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const inset = Math.max(
          0,
          window.innerHeight - vv.height - vv.offsetTop
        );
        root.style.setProperty("--rc-keyboard-inset", `${Math.round(inset)}px`);
      });
    };

    update();

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    if ("virtualKeyboard" in navigator) {
      try {
        // @ts-expect-error Experimental API.
        navigator.virtualKeyboard.overlaysContent = true;
      } catch {
        // Ignore.
      }
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.setProperty("--rc-keyboard-inset", "0px");
    };
  }, []);

  return null;
}

