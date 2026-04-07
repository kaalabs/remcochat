import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/i18n-provider";
import { NotesCard } from "../src/components/notes-card";
import type { NotesToolOutput } from "../src/domain/notes/types";
import type { QuickNote } from "../src/domain/notes/types";

function createNote(overrides: Partial<QuickNote> = {}): QuickNote {
  return {
    id: overrides.id ?? "note-1",
    profileId: overrides.profileId ?? "profile-1",
    content: overrides.content ?? "Bel de tandarts morgen om 10:00",
    createdAt: overrides.createdAt ?? "2026-03-26T16:40:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-26T16:40:00.000Z",
  };
}

test("NotesCard keeps a successful local delete until a new upstream snapshot arrives", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
  const previousFetch = globalThis.fetch;
  const previousActEnvironment = (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;

  const fetchCalls: Array<{ body: string; method: string; url: string }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      return {
        ok: true,
        async json() {
          return {
            notes: [],
            totalCount: 0,
            limit: 6,
          };
        },
      } as Response;
    },
  });

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  const initialNote = createNote();
  const baseProps: NotesToolOutput & { profileId: string } = {
    limit: 6,
    notes: [initialNote],
    profileId: "profile-1",
    totalCount: 1,
  };
  const Provider = I18nProvider as unknown as (props: {
    initialUiLanguage: "en";
  }) => ReturnType<typeof createElement>;

  function NotesCardHarness(props: { sourceKey: string }) {
    return createElement(
      Provider,
      { initialUiLanguage: "en" },
      createElement(NotesCard, {
        ...baseProps,
        sourceKey: props.sourceKey,
      })
    );
  }

  function renderCard(sourceKey: string) {
    return createElement(NotesCardHarness, { sourceKey });
  }

  try {
    await act(async () => {
      root.render(renderCard("assistant-1:0"));
    });

    assert.match(container.textContent ?? "", /Bel de tandarts/i);

    const deleteButton = container.querySelector(
      '[data-testid="note:delete:note-1"]'
    );
    assert.ok(deleteButton);

    await act(async () => {
      deleteButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true })
      );
      await Promise.resolve();
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.method, "POST");
    assert.match(fetchCalls[0]?.url ?? "", /\/api\/profiles\/profile-1\/notes$/);
    assert.match(fetchCalls[0]?.body ?? "", /"action":"delete"/);
    assert.match(container.textContent ?? "", /No notes yet/i);

    await act(async () => {
      root.render(renderCard("assistant-1:0"));
    });

    assert.match(container.textContent ?? "", /No notes yet/i);

    await act(async () => {
      root.render(renderCard("assistant-2:0"));
    });

    assert.match(container.textContent ?? "", /Bel de tandarts/i);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previousNavigator,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: previousFetch,
    });
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
