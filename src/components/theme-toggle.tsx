"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { normalizeThemeSelection, toggleThemeFromResolved } from "@/lib/theme";
import { ChevronDownIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

export function ThemeToggle() {
  const { t } = useI18n();
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const focusComposerAfterMenuCloseRef = useRef(false);

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
      if (e.altKey) {
        setTheme("system");
      } else {
        setTheme(toggleThemeFromResolved(resolvedTheme));
      }
      requestComposerFocus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, resolvedTheme, setTheme]);

  if (!mounted) {
    return (
      <div className="flex">
        <Button
          aria-label={t("theme.toggle.aria")}
          className="h-9 w-9 rounded-r-none border-r-0"
          size="icon"
          variant="outline"
        />
        <Button
          aria-label={t("theme.menu.aria")}
          className="h-9 w-7 rounded-l-none px-0"
          size="icon"
          variant="outline"
        />
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";
  const themeSelection = normalizeThemeSelection(theme);

  return (
    <div className="flex">
      <Button
        aria-label={t("theme.toggle.aria")}
        className="h-9 w-9 rounded-r-none border-r-0"
        onClick={() => {
          setTheme(toggleThemeFromResolved(resolvedTheme));
          requestComposerFocus();
        }}
        size="icon"
        title={t("theme.toggle.title")}
        type="button"
        variant="outline"
      >
        {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("theme.menu.aria")}
            className="h-9 w-7 rounded-l-none px-0"
            size="icon"
            title={t("theme.menu.title")}
            type="button"
            variant="outline"
          >
            <ChevronDownIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(e) => {
            if (!focusComposerAfterMenuCloseRef.current) return;
            e.preventDefault();
            focusComposerAfterMenuCloseRef.current = false;
            requestAnimationFrame(() => {
              requestComposerFocus();
            });
          }}
        >
          <DropdownMenuRadioGroup
            onValueChange={(value) => {
              setTheme(value);
              focusComposerAfterMenuCloseRef.current = true;
            }}
            value={themeSelection}
          >
            <DropdownMenuRadioItem value="system">
              {t("theme.mode.system")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              {t("theme.mode.light")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              {t("theme.mode.dark")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
