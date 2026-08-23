import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("work surface keeps daily issue browsing primary and repository distribution secondary", async () => {
  const [index, app, styles] = await Promise.all([
    readFile("dashboard/index.html", "utf8"),
    readFile("dashboard/app.js", "utf8"),
    readFile("dashboard/work.css", "utf8")
  ]);

  assert.match(index, /id="issue-list"\s+class="issue-list"\s+role="list"/);
  assert.doesNotMatch(index, /<table|<tbody|table-frame/);
  assert.ok(
    index.indexOf('class="issue-section"') <
      index.indexOf('class="distribution-section"')
  );
  assert.match(index, /id="snapshot-freshness"[^>]*aria-live="polite"/);
  assert.match(app, /node\("article", "issue-row"\)/);
  assert.match(app, /formatRelativeAge\(issue\.updatedAt\)/);
  assert.match(app, /classifyIssue\(issue\)/);
  assert.match(styles, /\.issue-row\s*\{/);
  assert.match(styles, /\.work-state\.attention/);
  assert.match(styles, /\.distribution-section/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.doesNotMatch(styles, /min-width:\s*900px/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
});
