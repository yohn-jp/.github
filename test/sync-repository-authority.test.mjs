import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";

import {
  listSyncRepositories,
  renderTokenRepositories,
} from "../scripts/list-sync-repositories.mjs";

test("sync-groups is the repository authority for token scope", async () => {
  const config = yaml.load(await readFile(".github/sync-groups.yml", "utf8"));
  const repositories = listSyncRepositories(config);
  assert.ok(repositories.includes("yohn-jp/tsukai"));

  const tokenRepositories = renderTokenRepositories(config).split("\n");
  assert.deepEqual(
    tokenRepositories,
    repositories.map((repository) => repository.replace(/^yohn-jp\//, ""))
  );
});

test("sync workflow derives token scope instead of duplicating repository names", async () => {
  const workflow = await readFile(".github/workflows/sync-org-templates.yml", "utf8");
  assert.match(workflow, /id: sync-repositories/);
  assert.match(
    workflow,
    /repositories: \$\{\{ steps\.sync-repositories\.outputs\.repositories \}\}/
  );
  assert.doesNotMatch(workflow, /repositories:\s*\|/);
});
