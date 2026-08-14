import test from "node:test";
import assert from "node:assert/strict";
import { isDocsOnlyChange, globToRegExp } from "../scripts/is-docs-only-change.mjs";

const PATTERNS = ["docs/**", "**/*.md", "CHANGELOG.md"];

test("all changed files under docs/ are docs-only", () => {
  assert.equal(isDocsOnlyChange(["docs/a.md", "docs/nested/b.md"], PATTERNS), true);
});

test("a top-level markdown file matches **/*.md", () => {
  assert.equal(isDocsOnlyChange(["README.md"], PATTERNS), true);
});

test("mixing a source file fails the docs-only check", () => {
  assert.equal(isDocsOnlyChange(["docs/a.md", "src/index.ts"], PATTERNS), false);
});

test("empty changed-file list is not docs-only (no signal to fast-path on)", () => {
  assert.equal(isDocsOnlyChange([], PATTERNS), false);
});

test("** does not require a path separator to match a single-segment file", () => {
  assert.equal(isDocsOnlyChange(["CHANGELOG.md"], PATTERNS), true);
});

test("globToRegExp: * does not cross directory boundaries", () => {
  const re = globToRegExp("docs/*.md");
  assert.equal(re.test("docs/a.md"), true);
  assert.equal(re.test("docs/nested/a.md"), false);
});

test("globToRegExp: ** crosses directory boundaries", () => {
  const re = globToRegExp("docs/**");
  assert.equal(re.test("docs/a.md"), true);
  assert.equal(re.test("docs/nested/deeply/a.md"), true);
});
