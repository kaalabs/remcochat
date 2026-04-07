"use client";

import { useCallback, useEffect, useState } from "react";

type CreateAdminClientFeedbackCallbacksInput = {
  setError: (value: string | null) => void;
  setSaveNotice: (value: string | null) => void;
};

export function createAdminClientFeedbackCallbacks({
  setError,
  setSaveNotice,
}: CreateAdminClientFeedbackCallbacksInput) {
  return {
    clearError() {
      setError(null);
    },
    clearSaveNotice() {
      setSaveNotice(null);
    },
    showError(nextError: string) {
      setError(nextError);
    },
    showSaveNotice(notice: string) {
      setSaveNotice(notice);
    },
  };
}

export function useAdminClientFeedbackState() {
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearSaveNotice = useCallback(() => {
    setSaveNotice(null);
  }, []);

  const showError = useCallback((nextError: string) => {
    setError(nextError);
  }, []);

  const showSaveNotice = useCallback((notice: string) => {
    setSaveNotice(notice);
  }, []);

  useEffect(() => {
    if (!saveNotice) return;
    const timer = window.setTimeout(() => {
      clearSaveNotice();
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [clearSaveNotice, saveNotice]);

  return {
    clearError,
    clearSaveNotice,
    error,
    saveNotice,
    showError,
    showSaveNotice,
  };
}
