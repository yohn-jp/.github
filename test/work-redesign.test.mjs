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
  assert.ok(
    index.indexOf('class="work-header"') <
      index.indexOf('class="work-summary"') &&
      index.indexOf('class="work-summary"') <
        index.indexOf('class="issue-section"')
  );
  assert.match(index, /id="snapshot-freshness"[^>]*aria-live="polite"/);
  assert.match(app, /node\("article", "issue-row"\)/);
  assert.match(app, /formatRelativeAge\(issue\.updatedAt\)/);
  assert.match(app, /classifyIssue\(issue\)/);
  assert.match(app, /className: "progress", label: "In progress"/);
  assert.match(
    app,
    /stateGroup\.append\(node\("span", "attention-signal", "Needs attention"\)\)/
  );
  assert.match(app, /elements\.status\.className = "status-inline complete"/);
  assert.match(styles, /\.issue-row\s*\{/);
  assert.match(styles, /\.work-header\s*\{/);
  assert.match(styles, /\.attention-signal\s*\{/);
  assert.match(styles, /\.distribution-section/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.doesNotMatch(styles, /\.work-hero/);
  assert.doesNotMatch(styles, /min-width:\s*900px/);
  assert.doesNotMatch(styles, /overflow-x:\s*auto/);
});
