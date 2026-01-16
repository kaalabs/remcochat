import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__ } from "../src/ai/url-summary";

test("extracts title and site name", () => {
  const html = [
    "<html>",
    "<head>",
    "<title>Example Domain</title>",
    '<meta property="og:site_name" content="Example Site">',
    "</head>",
    "<body></body>",
    "</html>",
  ].join("");

  assert.equal(__test__.extractTitle(html), "Example Domain");
  assert.equal(__test__.extractSiteName(html), "Example Site");
});

test("extracts readable text from main content", () => {
  const html = [
    "<html>",
    "<head><title>Doc</title></head>",
    "<body>",
    "<script>console.log('ignore')</script>",
    "<article>",
    "<h1>Heading</h1>",
    "<p>Hello &amp; world from RemcoChat.</p>",
    "<p>Another paragraph.</p>",
    "</article>",
    "<main><p>Short block</p></main>",
    "</body>",
    "</html>",
  ].join("");

  const result = __test__.pickBestContent(html);
  assert.ok(result.text.includes("Hello & world from RemcoChat."));
  assert.ok(result.wordCount >= 5);
});
