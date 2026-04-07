import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  createAdminClientFeedbackCallbacks,
  useAdminClientFeedbackState,
} from "../src/app/admin/admin-client-feedback";

test("createAdminClientFeedbackCallbacks routes error and notice updates to the provided setters", () => {
  const errorValues: Array<string | null> = [];
  const noticeValues: Array<string | null> = [];

  const callbacks = createAdminClientFeedbackCallbacks({
    setError: (value) => {
      errorValues.push(value);
    },
    setSaveNotice: (value) => {
      noticeValues.push(value);
    },
  });

  callbacks.showError("provider failed");
  callbacks.clearError();
  callbacks.showSaveNotice("saved");
  callbacks.clearSaveNotice();

  assert.deepEqual(errorValues, ["provider failed", null]);
  assert.deepEqual(noticeValues, ["saved", null]);
});

test("useAdminClientFeedbackState keeps callback identities stable across rerenders", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
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

  const container = dom.window.document.getElementById("root");
  assert.ok(container);

  type FeedbackSnapshot = ReturnType<typeof useAdminClientFeedbackState>;

  const snapshots: FeedbackSnapshot[] = [];

  function Harness(props: {
    onSnapshot: (feedback: FeedbackSnapshot) => void;
    tick: number;
  }) {
    const feedback = useAdminClientFeedbackState();

    useEffect(() => {
      props.onSnapshot(feedback);
    }, [feedback, props]);

    return null;
  }

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        createElement(Harness, {
          onSnapshot: (feedback) => {
            snapshots.push(feedback);
          },
          tick: 0,
        })
      );
    });

    await act(async () => {
      root.render(
        createElement(Harness, {
          onSnapshot: (feedback) => {
            snapshots.push(feedback);
          },
          tick: 1,
        })
      );
    });

    assert.ok(snapshots.length >= 2);
    const firstSnapshot = snapshots[0];
    const latestSnapshot = snapshots.at(-1);

    assert.ok(firstSnapshot);
    assert.ok(latestSnapshot);
    assert.equal(latestSnapshot.clearError, firstSnapshot.clearError);
    assert.equal(latestSnapshot.clearSaveNotice, firstSnapshot.clearSaveNotice);
    assert.equal(latestSnapshot.showError, firstSnapshot.showError);
    assert.equal(latestSnapshot.showSaveNotice, firstSnapshot.showSaveNotice);
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
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
