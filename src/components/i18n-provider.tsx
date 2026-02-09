"use client";

import type { UiLanguage } from "@/lib/types";
import { localeForUiLanguage, type I18nKey, t as translate } from "@/lib/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type I18nContextValue = {
  uiLanguage: UiLanguage;
  setUiLanguage: (language: UiLanguage) => void;
  locale: string;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider(props: {
  initialUiLanguage: UiLanguage;
  children: ReactNode;
}) {
  const [uiLanguage, setUiLanguageState] = useState<UiLanguage>(
    props.initialUiLanguage
  );

  const setUiLanguage = useCallback((language: UiLanguage) => {
    setUiLanguageState(language);
    try {
      document.documentElement.lang = language;
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.lang = uiLanguage;
    } catch {
      // ignore
    }
  }, [uiLanguage]);

  const locale = useMemo(() => {
    return localeForUiLanguage(uiLanguage);
  }, [uiLanguage]);

  const t = useCallback(
    (key: I18nKey, vars?: Record<string, string | number>) =>
      translate(uiLanguage, key, vars),
    [uiLanguage]
  );

  const value = useMemo<I18nContextValue>(() => {
    return { uiLanguage, setUiLanguage, locale, t };
  }, [locale, setUiLanguage, t, uiLanguage]);

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

