import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AdminClientHeader,
  getAdminClientRefreshIconClassName,
  shouldDisableAdminClientRetest,
} from "../src/app/admin/admin-client-header";

const t = ((key: string) => key) as (key: string) => string;

test("shouldDisableAdminClientRetest only disables when any retest dependency is busy", () => {
  assert.equal(
    shouldDisableAdminClientRetest({
      inventoryLoading: false,
      readinessRetesting: false,
      skillsLoading: false,
    }),
    false
  );
  assert.equal(
    shouldDisableAdminClientRetest({
      inventoryLoading: true,
      readinessRetesting: false,
      skillsLoading: false,
    }),
    true
  );
  assert.equal(
    shouldDisableAdminClientRetest({
      inventoryLoading: false,
      readinessRetesting: true,
      skillsLoading: false,
    }),
    true
  );
});

test("getAdminClientRefreshIconClassName adds the spinner class while retesting is disabled", () => {
  assert.doesNotMatch(
    getAdminClientRefreshIconClassName({
      inventoryLoading: false,
      readinessRetesting: false,
      skillsLoading: false,
    }),
    /animate-spin/
  );
  assert.match(
    getAdminClientRefreshIconClassName({
      inventoryLoading: false,
      readinessRetesting: true,
      skillsLoading: false,
    }),
    /animate-spin/
  );
});

test("AdminClientHeader renders the save notice and both header actions", () => {
  const html = renderToStaticMarkup(
    createElement(AdminClientHeader, {
      inventoryLoading: false,
      onRetestAllReadiness: () => {},
      readinessRetesting: false,
      saveNotice: "saved",
      skillsLoading: false,
      t,
    })
  );

  assert.match(html, /saved/);
  assert.match(html, /aria-label="common\.refresh"/);
  assert.match(html, /href="\/"/);
});
