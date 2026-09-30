import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import {
  expandSyncConfig,
  findMissingWorkflowDependencies
} from "../scripts/generate-sync-config.mjs";

const codeqlWorkflow = `
name: CodeQL
# ./.github/codeql/ignored-comment.yml
jobs:
  analyze:
    uses: yohn-jp/.github/.github/workflows/codeql.yml@main
    with:
      config-file: ./.github/codeql/codeql-config.yml
`;
const sources = {
  "templates/workflows/codeql.yml": codeqlWorkflow,
  ".github/codeql/codeql-config.yml": "paths-ignore: []\n"
};
const readSource = (source) => sources[source];

function expand(fileGroups, bundles = {}, include = ["standard"]) {
  return expandSyncConfig({
    version: 1,
    "file-groups": fileGroups,
    bundles,
    "sync-groups": { g: { repositories: ["yohn-jp/repo"], include } }
  });
}

const workflowEntry = {
  source: "templates/workflows/codeql.yml",
  dest: ".github/workflows/codeql.yml"
};
const configEntry = {
  source: ".github/codeql/codeql-config.yml",
  dest: ".github/codeql/codeql-config.yml"
};

test("workflow without its referenced config is reported", () => {
  const repositories = expand({ standard: [workflowEntry] });
  const problems = findMissingWorkflowDependencies(repositories, readSource);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /yohn-jp\/repo/);
  assert.match(problems[0], /\.github\/workflows\/codeql\.yml/);
  assert.match(problems[0], /\.github\/codeql\/codeql-config\.yml/);
});

test("bundle distributes workflow together with its dependency", () => {
  const repositories = expand({}, { codeql: [workflowEntry, configEntry] }, [
    "codeql"
  ]);
  assert.deepEqual(
    findMissingWorkflowDependencies(repositories, readSource),
    []
  );
});

test("unknown include and ambiguous names are rejected", () => {
  assert.throws(
    () => expand({}, {}, ["missing"]),
    /unknown file group or bundle/
  );
  assert.throws(
    () => expand({ codeql: [] }, { codeql: [] }),
    /both a file group and a bundle/
  );
});

test("repository sync groups distribute every workflow dependency", () => {
  const config = yaml.load(readFileSync(".github/sync-groups.yml", "utf8"));
  const problems = findMissingWorkflowDependencies(
    expandSyncConfig(config),
    (source) => readFileSync(source, "utf8")
  );
  assert.deepEqual(problems, []);
});

test("every repository distributing codeql.yml also gets the CodeQL config", () => {
  const config = yaml.load(readFileSync(".github/sync-groups.yml", "utf8"));
  for (const [repository, mappings] of Object.entries(
    expandSyncConfig(config)
  )) {
    const dests = mappings.map(({ dest }) => dest);
    if (dests.includes(".github/workflows/codeql.yml")) {
      assert.ok(
        dests.includes(".github/codeql/codeql-config.yml"),
        `${repository} lacks CodeQL config`
      );
    }
  }
});

test("default-include applies to every group and conflicting dests are rejected", () => {
  const base = {
    version: 1,
    "default-include": ["common"],
    "file-groups": {
      common: [{ source: "a.md", dest: "a.md" }],
      one: [{ source: "x.yml", dest: "ci.yml" }],
      two: [{ source: "y.yml", dest: "ci.yml" }]
    }
  };
  const expanded = expandSyncConfig({
    ...base,
    "sync-groups": {
      g: { repositories: ["yohn-jp/r"], include: ["one"] },
      empty: { repositories: ["yohn-jp/e"], include: [] }
    }
  });
  assert.deepEqual(
    expanded["yohn-jp/r"].map(({ dest }) => dest),
    ["a.md", "ci.yml"]
  );
  assert.deepEqual(
    expanded["yohn-jp/e"].map(({ dest }) => dest),
    ["a.md"]
  );
  assert.throws(
    () =>
      expandSyncConfig({
        ...base,
        "sync-groups": {
          g: { repositories: ["yohn-jp/r"], include: ["one", "two"] }
        }
      }),
    /ci\.yml is mapped from both/
  );
});

test("sync.yml is the single generated config and carries agent governance for every repository", () => {
  const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
  const workflow = readFileSync(
    ".github/workflows/sync-org-templates.yml",
    "utf8"
  );
  assert.doesNotMatch(workflow, /sync-agents\.yml|sync-common\.yml/);
  assert.equal((workflow.match(/CONFIG_PATH:/g) ?? []).length, 1);
  for (const [repository, mappings] of Object.entries(sync)) {
    const skills = mappings.find(
      ({ dest }) => dest === ".github/agent-governance/skills/"
    );
    assert.equal(skills?.deleteOrphaned, true, `${repository} skills mapping`);
    assert.ok(
      mappings.some(({ dest }) => dest === "CLAUDE.md"),
      `${repository} CLAUDE.md`
    );
  }
});
