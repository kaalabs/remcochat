import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessibleChatFolder } from "../src/domain/folders/types";
import {
  getOwnedFolders,
  groupSharedFoldersByOwner,
  parseFolderGroupCollapsedState,
} from "../src/app/home-client-folders";

function folder(
  overrides: Partial<AccessibleChatFolder> = {},
): AccessibleChatFolder {
  return {
    id: "folder-1",
    profileId: "profile-1",
    name: "Folder",
    collapsed: false,
    scope: "owned",
    ownerName: "Owner",
    sharedWithCount: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

test("getOwnedFolders keeps only non-shared folders", () => {
  const result = getOwnedFolders([
    folder({ id: "owned", scope: "owned" }),
    folder({ id: "shared", scope: "shared", ownerName: "Alice" }),
  ]);

  assert.deepEqual(result.map((entry) => entry.id), ["owned"]);
});

test("groupSharedFoldersByOwner groups and sorts shared folders by owner label", () => {
  const result = groupSharedFoldersByOwner([
    folder({ id: "2", scope: "shared", ownerName: "zoe" }),
    folder({ id: "1", scope: "shared", ownerName: "Alice" }),
    folder({ id: "3", scope: "shared", ownerName: "alice" }),
    folder({ id: "owned", scope: "owned" }),
    folder({ id: "unknown", scope: "shared", ownerName: "   " }),
  ]);

  assert.deepEqual(
    result.map(([owner, entries]) => [owner, entries.map((entry) => entry.id)]),
    [
      ["Alice", ["1"]],
      ["alice", ["3"]],
      ["Unknown", ["unknown"]],
      ["zoe", ["2"]],
    ],
  );
});

test("parseFolderGroupCollapsedState tolerates invalid payloads and keeps only booleans", () => {
  assert.deepEqual(parseFolderGroupCollapsedState(null), {});
  assert.deepEqual(parseFolderGroupCollapsedState("not-json"), {});
  assert.deepEqual(parseFolderGroupCollapsedState("[]"), {});
  assert.deepEqual(
    parseFolderGroupCollapsedState(
      JSON.stringify({
        "folders:personal": true,
        "folders:shared": false,
        ignore: "yes",
        nested: { nope: true },
      }),
    ),
    {
      "folders:personal": true,
      "folders:shared": false,
    },
  );
});
