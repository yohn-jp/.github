import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MESSAGE_CATALOG,
  formatRelativeTime,
  formatSnapshotAge,
  localeDate,
  normalizeLocale,
  resolveHtmlLocale,
  resolveHtmlMessages,
  resolveMessage,
  resolveRuntimeLocale
} from "../messages.js";

const sourceFiles = [
  "portal/index.html",
  "dashboard/index.html",
  "dashboard/graph/index.html"
];

test("all static UI message keys resolve from the English catalog", async () => {
  const source = await Promise.all(
    sourceFiles.map((path) => readFile(path, "utf8"))
  );
  const keys = new Set(
    source
      .join("\n")
      .matchAll(/data-message(?:-[a-z-]+)?="([^"]+)"/g)
      .map((match) => match[1])
  );
  assert.ok(keys.size > 0);
  for (const key of keys) assert.doesNotThrow(() => resolveMessage(key));
});

test("runtime locale follows explicit page language and defaults to English", () => {
  assert.equal(
    resolveRuntimeLocale({ documentElement: { lang: "ja-JP" } }),
    "ja-JP"
  );
  assert.equal(resolveRuntimeLocale({ documentElement: { lang: "" } }), "en");
  assert.equal(resolveRuntimeLocale({}), "en");
  assert.equal(normalizeLocale("EN-us"), "en-US");
});

test("locale resolution prefers exact catalog matches before base fallback", () => {
  const catalog = {
    en: { greeting: "English" },
    "en-GB": { greeting: "British English" },
    ja: { greeting: "Japanese" }
  };
  assert.equal(
    resolveMessage("greeting", {}, { catalog, locale: "en-GB" }),
    "British English"
  );
  assert.equal(
    resolveMessage("greeting", {}, { catalog, locale: "en-US" }),
    "English"
  );
  assert.equal(
    resolveMessage("greeting", {}, { catalog, locale: "ja-JP" }),
    "Japanese"
  );
  assert.equal(
    resolveHtmlLocale('<html lang="ja-JP"><body></body></html>'),
    "ja-JP"
  );
});

test("message interpolation is explicit and missing keys fail", () => {
  assert.equal(
    resolveMessage(
      "example",
      { value: "catalog" },
      {
        catalog: { en: { example: "A {value}" } },
        locale: "en"
      }
    ),
    "A catalog"
  );
  assert.throws(
    () => resolveMessage("missing.key"),
    /Missing message key: missing\.key/
  );
  assert.throws(
    () =>
      resolveMessage(
        "example",
        {},
        {
          catalog: { en: { example: "A {value}" } },
          locale: "en"
        }
      ),
    /Missing value "value" for message key "example"/
  );
});

test("HTML message directives resolve content and attributes without fallback", () => {
  const html = resolveHtmlMessages(
    '<title data-message="work.title"></title><input placeholder="" data-message-placeholder="work.filters.searchPlaceholder" />'
  );
  assert.match(
    html,
    /<title data-message="work\.title">Open work · yohn-jp<\/title>/
  );
  assert.match(html, /placeholder="Title, product, label, assignee…"/);
  assert.throws(
    () => resolveHtmlMessages('<p data-message="missing.key"></p>'),
    /Missing message key: missing\.key/
  );
});

test("date and relative-time helpers use Intl formatting", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-08-27T12:00:00Z");
  try {
    assert.match(localeDate("2026-08-27T11:00:00Z", "en-US"), /2026/);
    assert.equal(
      formatRelativeTime("2026-08-27T11:55:00Z", "en-US"),
      "Updated 5m ago"
    );
    assert.equal(
      formatSnapshotAge("2026-08-27T10:00:00Z", "en-US"),
      "2 hours old"
    );
  } finally {
    Date.now = originalNow;
  }
  assert.ok(MESSAGE_CATALOG.en["work.updated.relative"]);
});
