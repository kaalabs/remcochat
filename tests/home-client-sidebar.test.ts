import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AccessibleChat } from "../src/domain/chats/types";
import type { Profile } from "../src/domain/profiles/types";
import {
  HomeClientSidebar,
} from "../src/app/home-client-sidebar";

function makeChat(overrides: Partial<AccessibleChat> = {}): AccessibleChat {
  return {
    id: overrides.id ?? "chat-1",
    profileId: overrides.profileId ?? "profile-1",
    title: overrides.title ?? "Chat",
    modelId: overrides.modelId ?? "test-model",
    folderId: overrides.folderId ?? null,
    pinnedAt: overrides.pinnedAt ?? null,
    chatInstructions: overrides.chatInstructions ?? "",
    chatInstructionsRevision: overrides.chatInstructionsRevision ?? 0,
    activatedSkillNames: overrides.activatedSkillNames ?? [],
    createdAt: overrides.createdAt ?? "2026-03-26T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T09:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    forkedFromChatId: overrides.forkedFromChatId,
    forkedFromMessageId: overrides.forkedFromMessageId,
    scope: overrides.scope ?? "owned",
    ownerName: overrides.ownerName ?? "Owner",
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "Remco",
    defaultModelId: overrides.defaultModelId ?? "test-model",
    customInstructions: overrides.customInstructions ?? "",
    customInstructionsRevision: overrides.customInstructionsRevision ?? 0,
    memoryEnabled: overrides.memoryEnabled ?? true,
    uiLanguage: overrides.uiLanguage ?? "en",
    avatar: overrides.avatar ?? null,
    createdAt: overrides.createdAt ?? "2026-03-26T09:00:00.000Z",
  };
}

const t = ((key: string, vars?: Record<string, unknown>) =>
  key === "sidebar.archived"
    ? `archived:${String(vars?.count ?? "")}`
    : key) as (key: string, vars?: Record<string, unknown>) => string;

test("HomeClientSidebar composes the shell, chat lists, and profile footer", () => {
  const activeProfile = makeProfile();
  const rootChat = makeChat({ id: "root-chat", title: "Root chat" });
  const archivedChat = makeChat({
    id: "archived-chat",
    title: "Archived chat",
    archivedAt: "2026-03-26T09:05:00.000Z",
  });

  const html = renderToStaticMarkup(
    createElement(HomeClientSidebar, {
      activeProfile,
      appVersion: "0.26.8",
      archivedChats: [archivedChat],
      archivedOpen: true,
      chats: [rootChat, archivedChat],
      deleteChatError: null,
      desktopSidebarCollapsed: false,
      folderActionsDisabled: () => false,
      folderError: null,
      folderGroupCollapsed: {},
      mode: "desktop",
      onArchivedOpenChange: () => {},
      onCloseDrawer: () => {},
      onCollapseDesktop: () => {},
      onCreateChat: () => {},
      onCreateFolder: () => {},
      onCreateProfile: () => {},
      onDeleteFolder: () => {},
      onManageFolderSharing: () => {},
      onOpenChangeProfileSelect: () => {},
      onOpenProfileSettings: () => {},
      onRenameFolder: () => {},
      onSelectProfile: () => {},
      onSetFolderGroupCollapsedValue: () => {},
      onShareFolder: () => {},
      onToggleFolderCollapsed: () => {},
      ownedFolders: [],
      profiles: [activeProfile],
      renderArchivedChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `archived-row:${chat.id}`, key: chat.id },
          chat.title
        ),
      renderChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `root-row:${chat.id}`, key: chat.id },
          chat.title
        ),
      rootChats: [rootChat],
      sharedFoldersByOwner: [],
      showFoldersSeparator: true,
      statusReady: true,
      t,
    })
  );

  assert.match(html, /data-testid="sidebar:chats-active"/);
  assert.match(html, /data-testid="sidebar:new-chat"/);
  assert.match(html, /data-testid="root-row:root-chat"/);
  assert.match(html, /data-testid="sidebar:chats-archived"/);
  assert.match(html, /data-testid="archived-row:archived-chat"/);
  assert.match(html, /data-testid="profile:select-trigger"/);
  assert.match(html, /data-testid="app:version"/);
});
