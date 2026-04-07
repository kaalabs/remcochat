"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type { MemoryItem } from "@/domain/memory/types";
import type { Profile } from "@/domain/profiles/types";

type ProfileMemoryListResponse = {
  memory?: MemoryItem[];
};

type UseHomeClientProfileMemoryInput = {
  activeProfile: Profile | null;
  settingsOpen: boolean;
};

export function normalizeProfileMemoryItems(
  data: ProfileMemoryListResponse | null | undefined
): MemoryItem[] {
  return Array.isArray(data?.memory) ? data.memory : [];
}

export function useHomeClientProfileMemory({
  activeProfile,
  settingsOpen,
}: UseHomeClientProfileMemoryInput) {
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (!activeProfile) return;

    fetch(`/api/profiles/${activeProfile.id}/memory`)
      .then((response) => response.json())
      .then((data: ProfileMemoryListResponse) => {
        setMemoryItems(normalizeProfileMemoryItems(data));
      })
      .catch(() => {});
  }, [activeProfile, settingsOpen]);

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      if (!activeProfile) return;
      await fetch(`/api/profiles/${activeProfile.id}/memory/${memoryId}`, {
        method: "DELETE",
      }).catch(() => {});
      setMemoryItems((previous) => previous.filter((item) => item.id !== memoryId));
    },
    [activeProfile]
  );

  const addMemoryItem = useCallback((item: MemoryItem) => {
    setMemoryItems((previous) => [item, ...previous]);
  }, []);

  return {
    addMemoryItem,
    deleteMemory,
    memoryItems,
  };
}
