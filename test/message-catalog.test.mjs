import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MESSAGE_CATALOG,
  formatRelativeTime,
  formatSnapshotAge,
  localeDate,
  normalizeLocale,
  preserveLocaleQuery,
  resolveHtmlLocale,
  resolveHtmlMessages,
  resolveMessage,
  resolveRuntimeLocale
} from "../messages.js";

const sourceFiles = [
  "portal/index.html",
  "dashboard/index.html",
  "dashboard/graph/index.html",
  "dashboard/governance/index.html"
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

test("English and Japanese catalogs expose the same complete UI contract", () => {
  assert.deepEqual(
    Object.keys(MESSAGE_CATALOG.en).sort(),
    Object.keys(MESSAGE_CATALOG.ja).sort()
  );
  assert.equal(
    resolveMessage("portal.nav.products", {}, { locale: "ja" }),
    "プロダクト"
  );
  assert.notEqual(
    resolveMessage("work.filters.searchPlaceholder", {}, { locale: "ja" }),
    resolveMessage("work.filters.searchPlaceholder", {}, { locale: "en" })
  );
});

test("Japanese catalog translates every governance Work message", () => {
  const governanceKeys = [
    "work.metrics.governanceValid",
    "work.metrics.governanceInvalid",
    "work.metrics.governanceUnknown",
    "work.filters.governance",
    "work.governance.filter.all",
    "work.governance.filter.valid",
    "work.governance.filter.invalid",
    "work.governance.filter.unknown",
    "work.governance.status.valid",
    "work.governance.status.invalid",
    "work.governance.status.unknown",
    "work.governance.violations.one",
    "work.governance.violations.other",
    "work.governance.violations.unspecified",
    "work.governance.violations.noDetail"
  ];
  for (const key of governanceKeys) {
    assert.notEqual(
      MESSAGE_CATALOG.ja[key],
      MESSAGE_CATALOG.en[key],
      `${key} must not fall back to English`
    );
  }
});

test("Japanese catalog translates every governance health message", () => {
  const governanceKeys = [
    "portal.nav.governance",
    "portal.work.openGovernance",
    "work.nav.governance",
    "work.distribution.governanceLink",
    "work.footer.governance",
    "governance.title",
    "governance.meta.description",
    "governance.nav.governance",
    "governance.header.eyebrow",
    "governance.header.title",
    "governance.header.lede",
    "governance.snapshot.loading",
    "governance.snapshot.complete",
    "governance.snapshot.partial",
    "governance.snapshot.failed",
    "governance.snapshot.unavailable",
    "governance.snapshot.detail",
    "governance.metrics.valid",
    "governance.metrics.invalid",
    "governance.metrics.unknown",
    "governance.repositories.title",
    "governance.repositories.body",
    "governance.repository.rateUnavailable",
    "governance.violations.title",
    "governance.issues.title",
    "governance.issues.invalid",
    "governance.issues.unknown",
    "governance.load.failedTitle",
    "governance.footer.work"
  ];
  for (const key of governanceKeys) {
    assert.notEqual(
      MESSAGE_CATALOG.ja[key],
      MESSAGE_CATALOG.en[key],
      `${key} must not fall back to English`
    );
  }
});

test("locale links preserve Work query and hash when switching", () => {
  const links = [
    {
      getAttribute: () => "/ja/work/",
      setAttribute(name, value) {
        this[name] = value;
      }
    },
    {
      getAttribute: () => "/en/work/",
      setAttribute(name, value) {
        this[name] = value;
      }
    }
  ];
  preserveLocaleQuery(
    { querySelectorAll: () => links },
    {
      href: "https://dev.yohn.jp/en/work/?view=invalid&q=contract&governance=invalid#issues",
      search: "?view=invalid&q=contract&governance=invalid",
      hash: "#issues"
    }
  );
  assert.equal(
    links[0].href,
    "/ja/work/?view=invalid&q=contract&governance=invalid#issues"
  );
  assert.equal(
    links[1].href,
    "/en/work/?view=invalid&q=contract&governance=invalid#issues"
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

test("HTML message directives support formatted closing tags", () => {
  const html = resolveHtmlMessages(
    '<label><span data-message="work.filters.governance"></span\n></label>',
    "ja"
  );
  assert.match(
    html,
    /data-message="work\.filters\.governance">ガバナンス<\/span\s*>/
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
    assert.match(
      formatRelativeTime("2026-08-27T11:55:00Z", "ja"),
      /更新.*分前/
    );
    assert.match(localeDate("2026-08-27T11:00:00Z", "ja"), /2026/);
  } finally {
    Date.now = originalNow;
  }
  assert.ok(MESSAGE_CATALOG.en["work.updated.relative"]);
});
