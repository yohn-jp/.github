import test from "node:test";
import assert from "node:assert/strict";
import { countTemplateIdentityMarkerAttempts } from "../scripts/pr-template-marker.mjs";

test("no marker attempts in an ordinary body", () => {
  assert.equal(countTemplateIdentityMarkerAttempts("## Summary\n\nBody.\n"), 0);
});

test("counts a single marker attempt", () => {
  const body = `## Summary\n\nBody.\n\n<!-- inari:template {"version":"1","kind":"pull_request","path":".github/PULL_REQUEST_TEMPLATE/default.md"} -->\n`;
  assert.equal(countTemplateIdentityMarkerAttempts(body), 1);
});

test("counts a malformed marker attempt as an attempt", () => {
  const body = "## Summary\n\n<!-- inari:template {not-json} -->\n";
  assert.equal(countTemplateIdentityMarkerAttempts(body), 1);
});

test("counts every marker-shaped line, not just the trailing one", () => {
  const body = [
    '<!-- inari:template {"version":"1","kind":"pull_request","path":"a.md"} -->',
    "",
    "## Summary",
    "",
    '<!-- inari:template {"version":"1","kind":"pull_request","path":"b.md"} -->',
    ""
  ].join("\n");
  assert.equal(countTemplateIdentityMarkerAttempts(body), 2);
});

test("ignores empty or non-string bodies", () => {
  assert.equal(countTemplateIdentityMarkerAttempts(""), 0);
  assert.equal(countTemplateIdentityMarkerAttempts(undefined), 0);
});
