import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAdminLocalAccessDraftChanges,
  normalizeAdminWebSearchDraftSelection,
  splitAdminConfigList,
} from "../src/app/admin/admin-client-integrations";
import type {
  LocalAccessResponse,
  WebSearchProviderResponse,
} from "../src/app/admin/admin-client-api";

test("normalizeAdminWebSearchDraftSelection keeps a known selected provider", () => {
  const config: WebSearchProviderResponse = {
    enabled: true,
    selectedProviderId: "exa",
    providers: [
      { id: "exa", label: "Exa" },
      { id: "brave", label: "Brave" },
    ],
  };

  assert.equal(normalizeAdminWebSearchDraftSelection(config), "exa");
});

test("normalizeAdminWebSearchDraftSelection falls back to the first provider when the selection is unknown", () => {
  const config: WebSearchProviderResponse = {
    enabled: true,
    selectedProviderId: "missing",
    providers: [
      { id: "exa", label: "Exa" },
      { id: "brave", label: "Brave" },
    ],
  };

  assert.equal(normalizeAdminWebSearchDraftSelection(config), "exa");
});

test("splitAdminConfigList trims entries and accepts commas or newlines", () => {
  assert.deepEqual(
    splitAdminConfigList(" git status ,\n  ls -la\n\npwd "),
    ["git status", "ls -la", "pwd"]
  );
});

test("hasAdminLocalAccessDraftChanges detects unchanged drafts", () => {
  const config: LocalAccessResponse = {
    configured: true,
    enabled: true,
    allowedCommands: ["git status", "pwd"],
    allowedDirectories: ["/tmp", "/var/log"],
  };

  assert.equal(
    hasAdminLocalAccessDraftChanges({
      commandsDraft: "git status\npwd",
      config,
      directoriesDraft: "/tmp\n/var/log",
      enabledDraft: true,
    }),
    false
  );
});

test("hasAdminLocalAccessDraftChanges detects command, directory, and enabled changes", () => {
  const config: LocalAccessResponse = {
    configured: true,
    enabled: false,
    allowedCommands: ["git status"],
    allowedDirectories: ["/tmp"],
  };

  assert.equal(
    hasAdminLocalAccessDraftChanges({
      commandsDraft: "git status\npwd",
      config,
      directoriesDraft: "/tmp\n/var/log",
      enabledDraft: true,
    }),
    true
  );
});
