import { useCallback, useMemo, useState } from "react";
import type { AccessibleChatFolder } from "@/domain/folders/types";

const UNKNOWN_OWNER_LABEL = "Unknown";

export function getOwnedFolders(
  folders: AccessibleChatFolder[],
): AccessibleChatFolder[] {
  return folders.filter((folder) => folder.scope !== "shared");
}

export function groupSharedFoldersByOwner(
  folders: AccessibleChatFolder[],
): Array<[string, AccessibleChatFolder[]]> {
  const grouped = new Map<string, AccessibleChatFolder[]>();
  for (const folder of folders) {
    if (folder.scope !== "shared") continue;
    const owner = String(folder.ownerName ?? "").trim() || UNKNOWN_OWNER_LABEL;
    const existing = grouped.get(owner);
    if (existing) existing.push(folder);
    else grouped.set(owner, [folder]);
  }
  return Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function parseFolderGroupCollapsedState(
  raw: string | null,
): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const next: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

export function useFolderSidebarGroups(input: {
  activeProfileId: string;
  folders: AccessibleChatFolder[];
}) {
  const ownedFolders = useMemo(
    () => getOwnedFolders(input.folders),
    [input.folders],
  );
  const sharedFoldersByOwner = useMemo(
    () => groupSharedFoldersByOwner(input.folders),
    [input.folders],
  );

  const folderGroupCollapsedStorageKey = useMemo(
    () =>
      input.activeProfileId
        ? `remcochat:folderGroupCollapsed:${input.activeProfileId}`
        : "",
    [input.activeProfileId],
  );

  const [folderGroupCollapsedOverrides, setFolderGroupCollapsedOverrides] =
    useState<Record<string, Record<string, boolean>>>({});

  const folderGroupCollapsed = useMemo(() => {
    const override = folderGroupCollapsedOverrides[folderGroupCollapsedStorageKey];
    if (override) return override;
    if (!folderGroupCollapsedStorageKey || typeof window === "undefined") {
      return {};
    }
    return parseFolderGroupCollapsedState(
      window.localStorage.getItem(folderGroupCollapsedStorageKey),
    );
  }, [folderGroupCollapsedOverrides, folderGroupCollapsedStorageKey]);

  const setFolderGroupCollapsedValue = useCallback(
    (groupId: string, collapsed: boolean) => {
      if (!folderGroupCollapsedStorageKey) return;
      setFolderGroupCollapsedOverrides((prev) => {
        const current =
          prev[folderGroupCollapsedStorageKey] ??
          (typeof window === "undefined"
            ? {}
            : parseFolderGroupCollapsedState(
                window.localStorage.getItem(folderGroupCollapsedStorageKey),
              ));
        if (current[groupId] === collapsed) return prev;
        const next = { ...current, [groupId]: collapsed };
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(
              folderGroupCollapsedStorageKey,
              JSON.stringify(next),
            );
          } catch {
            // ignore
          }
        }
        return { ...prev, [folderGroupCollapsedStorageKey]: next };
      });
    },
    [folderGroupCollapsedStorageKey],
  );

  return {
    folderGroupCollapsed,
    ownedFolders,
    setFolderGroupCollapsedValue,
    sharedFoldersByOwner,
  };
}
