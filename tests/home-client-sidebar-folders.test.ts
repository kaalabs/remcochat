import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AccessibleChat } from "../src/domain/chats/types";
import type { AccessibleChatFolder } from "../src/domain/folders/types";
import {
  HomeClientSidebarFolders,
} from "../src/app/home-client-sidebar-folders";

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

function makeFolder(
  overrides: Partial<AccessibleChatFolder> = {}
): AccessibleChatFolder {
  return {
    id: overrides.id ?? "folder-1",
    profileId: overrides.profileId ?? "profile-1",
    name: overrides.name ?? "Folder",
    collapsed: overrides.collapsed ?? false,
    scope: overrides.scope ?? "owned",
    ownerName: overrides.ownerName ?? "Owner",
    sharedWithCount: overrides.sharedWithCount ?? 0,
    createdAt: overrides.createdAt ?? "2026-03-26T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T09:00:00.000Z",
  };
}

test("HomeClientSidebarFolders renders owned and shared folder variants with stub chat rows", () => {
  const ownedFolder = makeFolder({
    id: "owned-folder",
    name: "Owned folder",
    scope: "owned",
    sharedWithCount: 1,
  });
  const sharedFolder = makeFolder({
    id: "shared-folder",
    name: "Shared folder",
    scope: "shared",
    ownerName: "Alice",
  });
  const chats = [
    makeChat({
      id: "owned-chat-pinned",
      title: "Owned chat",
      folderId: ownedFolder.id,
      pinnedAt: "2026-03-26T09:05:00.000Z",
      updatedAt: "2026-03-26T09:05:00.000Z",
    }),
    makeChat({
      id: "owned-chat-newer",
      title: "Owned chat newer",
      folderId: ownedFolder.id,
      updatedAt: "2026-03-26T09:04:00.000Z",
    }),
    makeChat({
      id: "owned-chat-archived",
      title: "Owned chat archived",
      folderId: ownedFolder.id,
      archivedAt: "2026-03-26T09:06:00.000Z",
      updatedAt: "2026-03-26T09:06:00.000Z",
    }),
    makeChat({
      id: "owned-chat-older",
      title: "Owned chat older",
      folderId: ownedFolder.id,
      updatedAt: "2026-03-26T09:03:00.000Z",
    }),
    makeChat({
      id: "shared-chat",
      title: "Shared chat",
      folderId: sharedFolder.id,
      scope: "shared",
      ownerName: "Alice",
    }),
  ];
  const t = ((key: string, vars?: Record<string, unknown>) =>
    key === "sidebar.shared_by"
      ? `shared_by:${String(vars?.ownerName ?? "")}`
      : key) as (key: string, vars?: Record<string, unknown>) => string;

  const html = renderToStaticMarkup(
    createElement(HomeClientSidebarFolders, {
      chats,
      folderActionsDisabled: () => false,
      folderGroupCollapsed: {},
      onDeleteFolder: () => {},
      onManageFolderSharing: () => {},
      onRenameFolder: () => {},
      onSetFolderGroupCollapsedValue: () => {},
      onShareFolder: () => {},
      onToggleFolderCollapsed: () => {},
      ownedFolders: [ownedFolder],
      renderChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `stub-chat:${chat.id}`, key: chat.id },
          chat.title
        ),
      sharedFoldersByOwner: [["Alice", [sharedFolder]]],
      t,
    })
  );

  const pinnedIndex = html.indexOf("stub-chat:owned-chat-pinned");
  const newerIndex = html.indexOf("stub-chat:owned-chat-newer");
  const olderIndex = html.indexOf("stub-chat:owned-chat-older");

  assert.notEqual(pinnedIndex, -1);
  assert.notEqual(newerIndex, -1);
  assert.notEqual(olderIndex, -1);
  assert.ok(pinnedIndex < newerIndex);
  assert.ok(newerIndex < olderIndex);
  assert.match(html, /data-testid="sidebar:folder-menu:owned-folder"/);
  assert.match(html, /data-testid="sidebar:folder:owned-folder"/);
  assert.doesNotMatch(html, /data-testid="sidebar:folder-menu:shared-folder"/);
  assert.match(html, /data-testid="sidebar:shared-folder:shared-folder"/);
  assert.match(html, /shared_by:Alice/);
  assert.doesNotMatch(html, /stub-chat:owned-chat-archived/);
  assert.match(html, /data-testid="stub-chat:shared-chat"/);
});
