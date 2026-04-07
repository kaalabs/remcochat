import assert from "node:assert/strict";
import test from "node:test";

import {
  runHomeClientProfileReset,
} from "../src/app/home-client-profile-reset";

test("runHomeClientProfileReset clears chat-scoped state and optionally updates profile state", () => {
  const calls: Array<[string, unknown]> = [];

  runHomeClientProfileReset({
    nextActiveProfileId: "profile-2",
    setActiveChatId: (value) => {
      calls.push(["activeChat", value]);
      return value;
    },
    setActiveProfileId: (value) => {
      calls.push(["activeProfile", value]);
      return value;
    },
    setChats: (value) => {
      calls.push(["chats", value]);
      return value;
    },
    setFolders: (value) => {
      calls.push(["folders", value]);
      return value;
    },
    setIsTemporaryChat: (value) => {
      calls.push(["temporary", value]);
      return value;
    },
    setVariantsByUserMessageId: (value) => {
      calls.push(["variants", value]);
      return value;
    },
  });

  assert.deepEqual(calls, [
    ["activeProfile", "profile-2"],
    ["chats", []],
    ["folders", []],
    ["activeChat", ""],
    ["variants", {}],
    ["temporary", false],
  ]);
});

test("runHomeClientProfileReset preserves optional behavior differences when setters are omitted", () => {
  const calls: Array<[string, unknown]> = [];

  runHomeClientProfileReset({
    nextActiveProfileId: "profile-2",
    setActiveChatId: (value) => {
      calls.push(["activeChat", value]);
      return value;
    },
    setActiveProfileId: (value) => {
      calls.push(["activeProfile", value]);
      return value;
    },
    setChats: (value) => {
      calls.push(["chats", value]);
      return value;
    },
  });

  assert.deepEqual(calls, [
    ["activeProfile", "profile-2"],
    ["chats", []],
    ["activeChat", ""],
  ]);
});
