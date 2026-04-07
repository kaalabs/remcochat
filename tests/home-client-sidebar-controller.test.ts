import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AccessibleChat } from "../src/domain/chats/types";
import type { Profile } from "../src/domain/profiles/types";
import {
  HomeClientSidebarController,
} from "../src/app/home-client-sidebar-controller";

function makeChat(input: {
  id: string;
  profileId?: string;
  folderId?: string | null;
  archivedAt?: string | null;
  pinnedAt?: string | null;
  updatedAt?: string;
}): AccessibleChat {
  return {
    id: input.id,
    title: input.id,
    profileId: input.profileId ?? "profile-1",
    modelId: "model-1",
    createdAt: "2026-03-26T12:40:00.000Z",
    updatedAt: input.updatedAt ?? "2026-03-26T12:40:00.000Z",
    folderId: input.folderId ?? null,
    chatInstructions: "",
    chatInstructionsRevision: 0,
    activatedSkillNames: [],
    scope: "owned",
    pinnedAt: input.pinnedAt ?? null,
    archivedAt: input.archivedAt ?? null,
    deletedAt: null,
    ownerName: "Owner",
  };
}

function makeProfile(
  overrides: Partial<Profile> & Pick<Profile, "id" | "name" | "defaultModelId"> = {
    id: "profile-1",
    name: "Owner",
    defaultModelId: "model-1",
  }
): Profile {
  return {
    id: overrides.id,
    name: overrides.name,
    createdAt: overrides.createdAt ?? "2026-03-26T12:00:00.000Z",
    defaultModelId: overrides.defaultModelId,
    customInstructions: overrides.customInstructions ?? "",
    customInstructionsRevision: overrides.customInstructionsRevision ?? 0,
    memoryEnabled: overrides.memoryEnabled ?? true,
    uiLanguage: overrides.uiLanguage ?? "en",
    avatar: overrides.avatar ?? null,
  };
}

function renderSidebarController(
  overrides: Partial<Parameters<typeof HomeClientSidebarController>[0]> = {}
) {
  const activeProfile = overrides.activeProfile ?? makeProfile();
  const chats = overrides.chats ?? [];

  return renderToStaticMarkup(
    createElement(HomeClientSidebarController, {
      activeChatId: "",
      activeProfile,
      appVersion: "0.26.8",
      archivedOpen: true,
      chats,
      closeSidebarDrawer: () => {},
      deleteChatError: null,
      desktopSidebarCollapsed: false,
      folderError: null,
      folderGroupCollapsed: {},
      hasArchivedChats: chats.some((chat) => Boolean(chat.archivedAt)),
      isTemporaryChat: false,
      mode: "desktop",
      onArchiveChatById: () => {},
      onArchivedOpenChange: () => {},
      onCollapseDesktop: () => {},
      onCreateChat: () => {},
      onCreateFolder: () => {},
      onCreateProfile: () => {},
      onDeleteChatById: () => {},
      onDeleteFolder: () => {},
      onExportChatById: () => {},
      onManageFolderSharing: () => {},
      onMoveChatToFolder: () => {},
      onOpenChangeProfileSelect: () => {},
      onOpenProfileSettings: () => {},
      onOpenRenameChat: () => {},
      onOpenRenameFolder: () => {},
      onOpenShareFolder: () => {},
      onSelectPersistedChat: () => {},
      onSelectProfile: () => {},
      onSetFolderGroupCollapsedValue: () => {},
      onToggleFolderCollapsed: () => {},
      onTogglePinChatById: () => {},
      onUnarchiveChatById: () => {},
      ownedFolders: [],
      profiles: activeProfile ? [activeProfile] : [],
      sharedFoldersByOwner: [],
      statusReady: true,
      t: (key: string) => key,
      ...overrides,
    })
  );
}

test("HomeClientSidebarController partitions archived and root chats and preserves sidebar sort order", () => {
  const chats = [
    makeChat({
      id: "archived",
      archivedAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-26T12:00:00.000Z",
    }),
    makeChat({
      id: "foldered",
      folderId: "folder-1",
      updatedAt: "2026-03-26T12:10:00.000Z",
    }),
    makeChat({
      id: "pinned",
      pinnedAt: "2026-03-26T12:30:00.000Z",
      updatedAt: "2026-03-26T12:20:00.000Z",
    }),
    makeChat({
      id: "recent",
      updatedAt: "2026-03-26T12:25:00.000Z",
    }),
  ];

  const html = renderSidebarController({
    activeChatId: "recent",
    chats,
  });

  assert.match(html, /data-testid="sidebar:chat:pinned"/);
  assert.match(html, /data-testid="sidebar:chat:recent"/);
  assert.doesNotMatch(html, /data-testid="sidebar:chat:foldered"/);
  assert.match(html, /data-testid="sidebar:archived-chat:archived"/);
  assert.match(
    html,
    /data-testid="sidebar:chat:pinned"[\s\S]*data-testid="sidebar:chat:recent"/
  );
});

test("HomeClientSidebarController disables pin and menu actions when the active profile is unavailable", () => {
  const html = renderSidebarController({
    activeProfile: null,
    chats: [makeChat({ id: "owned" })],
  });

  assert.match(html, /data-testid="sidebar:chat-pin:owned"[^>]*disabled=""/);
  assert.match(html, /data-testid="sidebar:chat-menu:owned"[^>]*disabled=""/);
});

test("HomeClientSidebarController disables menu actions for foreign chats", () => {
  const html = renderSidebarController({
    activeProfile: makeProfile({
      id: "profile-1",
      name: "Owner",
      defaultModelId: "model-1",
    }),
    chats: [makeChat({ id: "foreign", profileId: "profile-2" })],
  });

  assert.match(html, /data-testid="sidebar:chat-menu:foreign"[^>]*disabled=""/);
});
