import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTACHMENT_URL_PREFIX,
  makeAttachmentUrl,
  parseAttachmentUrl,
} from "../src/lib/attachment-url";

test("makeAttachmentUrl uses remcochat attachment scheme", () => {
  const url = makeAttachmentUrl("abc123");
  assert.equal(url, `${ATTACHMENT_URL_PREFIX}abc123`);
});

test("parseAttachmentUrl returns attachment id", () => {
  assert.equal(parseAttachmentUrl("remcochat://attachment/abc123"), "abc123");
});

test("parseAttachmentUrl rejects invalid urls", () => {
  assert.equal(parseAttachmentUrl("https://example.com/abc123"), null);
  assert.equal(parseAttachmentUrl("remcochat://attachment/"), null);
  assert.equal(parseAttachmentUrl("remcochat://attachment/   "), null);
  assert.equal(parseAttachmentUrl("remcochat://attachment/abc 123"), null);
  assert.equal(parseAttachmentUrl("remcochat://attachment/abc/123"), null);
});

