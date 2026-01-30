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

  assert.equal(__test__.extractTitle(html, "https://example.com"), "Example Domain");
  assert.equal(__test__.extractSiteName(html), "Example Site");
});

test("extracts readable text from main content", () => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Sample Article</title>
  <meta property="og:site_name" content="Test Site">
</head>
<body>
  <header>
    <nav>Home | About | Contact</nav>
  </header>
  <main>
    <article>
      <h1>Understanding Web Content</h1>
      <p>Hello &amp; world from RemcoChat. This is a test paragraph to verify that our content extraction works.</p>
      <p>Modern web content extraction requires sophisticated algorithms to identify the main article content.</p>
      <p>The Mozilla Readability library provides an excellent foundation for this task.</p>
    </article>
  </main>
  <footer>
    <p>&copy; 2026 Example Site. All rights reserved.</p>
  </footer>
</body>
</html>`;

  const result = __test__.pickBestContent(html, "https://example.com");
  assert.ok(result.text.includes("Hello & world from RemcoChat"));
  assert.ok(result.wordCount >= 10);
});

test("decodes HTML entities", () => {
  assert.equal(__test__.decodeHtmlEntities("Hello &amp; world"), "Hello & world");
  assert.equal(__test__.decodeHtmlEntities("&lt;tag&gt;"), "<tag>");
  assert.equal(__test__.decodeHtmlEntities("&copy; 2025"), "© 2025");
  assert.equal(__test__.decodeHtmlEntities("&euro;100"), "€100");
});

test("blocks private IP addresses", () => {
  assert.equal(__test__.isPrivateIP("http://localhost/test"), true);
  assert.equal(__test__.isPrivateIP("http://127.0.0.1/test"), true);
  assert.equal(__test__.isPrivateIP("http://192.168.1.1/test"), true);
  assert.equal(__test__.isPrivateIP("http://10.0.0.1/test"), true);
  assert.equal(__test__.isPrivateIP("http://172.16.0.1/test"), true);
  assert.equal(__test__.isPrivateIP("https://example.com/test"), false);
  assert.equal(__test__.isPrivateIP("https://github.com/test"), false);
});
