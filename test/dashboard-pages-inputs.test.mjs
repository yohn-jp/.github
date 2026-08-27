import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import yaml from "js-yaml";

async function discoverLocalScriptInputs(entrypoint) {
  const pending = [entrypoint];
  const visited = new Set();

  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);

    const source = await readFile(relativePath, "utf8");
    const localImports = source.matchAll(/from\s+["']\.\/([^"']+\.mjs)["']/g);
    for (const match of localImports) {
      const imported = posix.normalize(
        posix.join(posix.dirname(relativePath), match[1])
      );
      if (imported.startsWith("scripts/")) pending.push(imported);
    }
  }

  return [...visited].sort();
}

test("Pages push paths cover every transitive portal build script", async () => {
  const [workflowSource, inputs] = await Promise.all([
    readFile(".github/workflows/dashboard-pages.yml", "utf8"),
    discoverLocalScriptInputs("scripts/build-dashboard.mjs")
  ]);
  const workflow = yaml.load(workflowSource);
  const paths = workflow?.on?.push?.paths;

  assert.ok(Array.isArray(paths), "dashboard Pages workflow must define push paths");
  assert.equal(workflow?.on?.schedule?.[0]?.cron, "*/10 * * * *");
  assert.ok(paths.includes("portal/**"));
  assert.ok(paths.includes("dashboard/**"));
  assert.ok(paths.includes("messages.js"));
  assert.ok(paths.includes(".github/workflows/dashboard-pages.yml"));
  assert.ok(!paths.includes("scripts/**"), "trigger must remain bounded, not all scripts");

  for (const input of inputs) {
    assert.ok(paths.includes(input), `missing Pages trigger for ${input}`);
  }
});
