import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AccessibleChat } from "../src/domain/chats/types";
import {
  HomeClientSidebarChatLists,
  shouldRenderSidebarArchivedSection,
} from "../src/app/home-client-sidebar-chat-lists";

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

const t = ((key: string, vars?: Record<string, unknown>) =>
  key === "sidebar.archived"
    ? `archived:${String(vars?.count ?? "")}`
    : key) as (key: string, vars?: Record<string, unknown>) => string;

test("shouldRenderSidebarArchivedSection only renders when archived chats exist", () => {
  assert.equal(shouldRenderSidebarArchivedSection(0), false);
  assert.equal(shouldRenderSidebarArchivedSection(2), true);
});

test("HomeClientSidebarChatLists renders separator, root rows, and archived rows", () => {
  const rootChat = makeChat({ id: "root-chat", title: "Root chat" });
  const archivedChat = makeChat({
    id: "archived-chat",
    title: "Archived chat",
    archivedAt: "2026-03-26T09:05:00.000Z",
  });

  const html = renderToStaticMarkup(
    createElement(HomeClientSidebarChatLists, {
      archivedChats: [archivedChat],
      archivedOpen: true,
      onArchivedOpenChange: () => {},
      renderArchivedChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `archived-row:${chat.id}`, key: chat.id },
          chat.title
        ),
      renderRootChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `root-row:${chat.id}`, key: chat.id },
          chat.title
        ),
      rootChats: [rootChat],
      showFoldersSeparator: true,
      t,
    })
  );

  assert.match(html, /data-testid="sidebar:folders-separator"/);
  assert.match(html, /data-testid="root-row:root-chat"/);
  assert.match(
    html,
    /<button(?=[^>]*data-testid="sidebar:archived-toggle")(?=[^>]*data-state="open")(?=[^>]*aria-expanded="true")[^>]*>/
  );
  assert.match(html, /data-testid="sidebar:chats-archived"/);
  assert.match(html, /data-testid="archived-row:archived-chat"/);
  assert.match(html, /archived:1/);
});

test("HomeClientSidebarChatLists forwards closed-state trigger attributes from CollapsibleTrigger", () => {
  const archivedChat = makeChat({
    id: "archived-chat",
    title: "Archived chat",
    archivedAt: "2026-03-26T09:05:00.000Z",
  });

  const html = renderToStaticMarkup(
    createElement(HomeClientSidebarChatLists, {
      archivedChats: [archivedChat],
      archivedOpen: false,
      onArchivedOpenChange: () => {},
      renderArchivedChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `archived-row:${chat.id}`, key: chat.id },
          chat.title
        ),
      renderRootChatRow: (chat: AccessibleChat) =>
        createElement(
          "div",
          { "data-testid": `root-row:${chat.id}`, key: chat.id },
          chat.title
        ),
      rootChats: [],
      showFoldersSeparator: false,
      t,
    })
  );

  assert.match(
    html,
    /<button(?=[^>]*data-testid="sidebar:archived-toggle")(?=[^>]*data-state="closed")(?=[^>]*aria-expanded="false")[^>]*>/
  );
  assert.match(
    html,
    /<div(?=[^>]*data-slot="collapsible-content")(?=[^>]*hidden="")[^>]*>/
  );
});
