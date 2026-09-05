import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Work feedback keeps filter and snapshot updates finite and announced", async () => {
  const [index, app, styles] = await Promise.all([
    readFile("dashboard/index.html", "utf8"),
    readFile("dashboard/app.js", "utf8"),
    readFile("dashboard/work.css", "utf8")
  ]);

  assert.match(index, /id="snapshot-feedback"[^>]*role="status"/);
  assert.match(index, /id="filter-feedback"[^>]*role="status"/);
  assert.match(index, /id="issue-list"[\s\S]*aria-busy="false"/);
  assert.match(app, /function flashResultUpdate\(\)/);
  assert.match(app, /function showFilterFeedback\(shown\)/);
  assert.match(app, /function metricDelta\(value, previousValue\)/);
  assert.match(app, /SNAPSHOT_FEEDBACK_DURATION_MS/);
  assert.match(styles, /\.issue-list\.is-updating\s*\{/);
  assert.match(styles, /\.metric-card\.is-changed\s*\{/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    styles,
    /\.issue-row:hover,[\s\S]*\.issue-row:focus-within\s*\{/
  );
});

test("Governance status and evidence rows use shared motion and focus vocabulary", async () => {
  const [index, script, styles] = await Promise.all([
    readFile("dashboard/governance/index.html", "utf8"),
    readFile("dashboard/governance/governance.js", "utf8"),
    readFile("dashboard/governance/governance.css", "utf8")
  ]);

  assert.match(
    index,
    /class="governance-status-banner"[\s\S]*aria-busy="false"/
  );
  assert.match(index, /class="governance-metrics"[\s\S]*aria-live="polite"/);
  assert.match(index, /class="governance-header"[\s\S]*data-motion="reveal"/);
  assert.match(script, /function showLoading\(\)/);
  assert.match(script, /setAttribute\("aria-busy", "false"\)/);
  assert.match(styles, /\.governance-status-banner\.loading\s*\{/);
  assert.match(styles, /\.governance-metric\.valid\s*\{/);
  assert.match(
    styles,
    /\.governance-repository:hover,[\s\S]*\.governance-repository:focus-within/
  );
  assert.match(styles, /--motion-duration-base/);
});
