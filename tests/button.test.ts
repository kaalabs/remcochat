import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "../src/components/ui/button";

test("Button defaults to type button", () => {
  const html = renderToStaticMarkup(createElement(Button, null, "Open"));

  assert.match(html, /type="button"/);
});

test("Button preserves an explicit submit type", () => {
  const html = renderToStaticMarkup(
    createElement(Button, { type: "submit" }, "Save")
  );

  assert.match(html, /type="submit"/);
});
