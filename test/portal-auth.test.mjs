import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { resolvePortalCollectionToken } from "../scripts/build-dashboard.mjs";

const APP_TOKEN_ACTION =
  "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1";

function buildSteps(workflow) {
  const steps = workflow?.jobs?.build?.steps;
  assert.ok(Array.isArray(steps), "Pages build job must define steps");
  return steps;
}

function namedStep(steps, name) {
  const step = steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
}

test("portal collection token never falls back to repository-scoped credentials", () => {
  assert.equal(
    resolvePortalCollectionToken({
      PORTAL_GITHUB_TOKEN: "installation-token",
      GITHUB_TOKEN: "repository-token",
      GH_TOKEN: "developer-token"
    }),
    "installation-token"
  );
  assert.equal(
    resolvePortalCollectionToken({
      GITHUB_TOKEN: "repository-token",
      GH_TOKEN: "developer-token"
    }),
    ""
  );
  assert.equal(resolvePortalCollectionToken({}), "");
});

test("Pages workflow mints bounded App token from configured repository scope", async () => {
  const source = await readFile(".github/workflows/dashboard-pages.yml", "utf8");
  const workflow = yaml.load(source);
  const steps = buildSteps(workflow);
  const scope = namedStep(steps, "Resolve portal collection scope");
  const token = namedStep(steps, "Create portal collection token");
  const build = namedStep(steps, "Generate portal and dashboard data");

  assert.match(scope.run, /dashboard\/repositories\.json/);
  assert.match(scope.run, /config\.repositories\.join/);
  assert.match(scope.run, /owner=\$\{config\.organization\}/);

  assert.equal(token.uses, APP_TOKEN_ACTION);
  assert.equal(token.if, "${{ vars.PORTAL_APP_CLIENT_ID != '' }}");
  assert.equal(token.with["client-id"], "${{ vars.PORTAL_APP_CLIENT_ID }}");
  assert.equal(token.with["private-key"], "${{ secrets.PORTAL_APP_PRIVATE_KEY }}");
  assert.equal(token.with.owner, "${{ steps.portal-scope.outputs.owner }}");
  assert.equal(
    token.with.repositories,
    "${{ steps.portal-scope.outputs.repositories }}"
  );
  assert.equal(token.with["permission-issues"], "read");
  assert.equal(token.with["permission-pull-requests"], "read");
  assert.equal(token.with["permission-metadata"], "read");

  assert.deepEqual(build.env, {
    PORTAL_GITHUB_TOKEN: "${{ steps.portal-token.outputs.token }}"
  });
  assert.doesNotMatch(source, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.doesNotMatch(source, /GH_TOKEN:\s*\$\{\{/);
});

test("workflow repository scope comes from dashboard config rather than duplicate allowlist", async () => {
  const [source, configSource] = await Promise.all([
    readFile(".github/workflows/dashboard-pages.yml", "utf8"),
    readFile("dashboard/repositories.json", "utf8")
  ]);
  const config = JSON.parse(configSource);
  const workflow = yaml.load(source);
  const scope = namedStep(buildSteps(workflow), "Resolve portal collection scope");

  assert.match(scope.run, /config\.repositories/);
  for (const repository of config.repositories) {
    assert.doesNotMatch(
      scope.run,
      new RegExp(`^[\\s-]*${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s]*$`, "m"),
      `workflow must not duplicate configured repository ${repository}`
    );
  }
});
