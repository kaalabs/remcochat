import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdminResetData,
  splitAdminDangerDescription,
} from "../src/app/admin/admin-client-maintenance";

test("splitAdminDangerDescription preserves the RESET delimiter boundaries", () => {
  assert.deepEqual(splitAdminDangerDescription("Type RESET now"), [
    "Type ",
    " now",
  ]);
  assert.deepEqual(splitAdminDangerDescription("No code word here"), [
    "No code word here",
  ]);
});

test("canAdminResetData only allows the exact confirmation while idle", () => {
  assert.equal(
    canAdminResetData({ resetConfirm: "RESET", resetSaving: false }),
    true
  );
  assert.equal(
    canAdminResetData({ resetConfirm: "reset", resetSaving: false }),
    false
  );
  assert.equal(
    canAdminResetData({ resetConfirm: "RESET", resetSaving: true }),
    false
  );
});
