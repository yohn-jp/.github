import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertRegularPatchTargets,
  createProvenance,
  evaluateEligibility,
  upsertAutofixPullRequest,
  validatePatch,
  validateProvenance
} from "../scripts/prettier-autofix/lib.mjs";
import {
  pushGeneratedBranch,
  runPublish
} from "../scripts/prettier-autofix/publish.mjs";

const repository = "yohn-jp/example";
const pullRequest = 42;
const headRef = "feat/42-format-source";
const headSha = "a".repeat(40);
const patch = Buffer.from(
  [
    "diff --git a/src/example.js b/src/example.js",
    "index 1111111..2222222 100644",
    "--- a/src/example.js",
    "+++ b/src/example.js",
    "@@ -1 +1 @@",
    "-const value = 'x'",
    '+const value = "x";',
    ""
  ].join("\n")
);

function currentPullRequest(overrides = {}) {
  return {
    number: pullRequest,
    state: "open",
    base: { repo: { full_name: repository }, ref: "main" },
    head: {
      repo: { full_name: repository },
      ref: headRef,
      sha: headSha
    },
    ...overrides
  };
}

function provenance(overrides = {}) {
  return createProvenance({
    repository,
    pullRequest,
    headRepository: repository,
    headRef,
    headSha,
    patch,
    ...overrides
  });
}

function git(directory, args, options = {}) {
  return execFileSync("git", args, { cwd: directory, ...options });
}

function createSourceFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "prettier-autofix-"));
  git(directory, ["init", "-b", headRef]);
  git(directory, ["config", "user.name", "Test Author"]);
  git(directory, ["config", "user.email", "test@example.invalid"]);
  mkdirSync(path.join(directory, "src"));
  writeFileSync(path.join(directory, "src/example.js"), "const value = 'x'\n");
  git(directory, ["add", "src/example.js"]);
  git(directory, ["commit", "-m", "source"]);
  const sha = git(directory, ["rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim();
  writeFileSync(path.join(directory, "src/example.js"), 'const value = "x";\n');
  const formattedPatch = git(
    directory,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "HEAD",
      "--"
    ],
    { encoding: "buffer" }
  );
  git(directory, ["checkout", "--", "src/example.js"]);
  return { directory, sha, patch: formattedPatch };
}

test("same-repository dirty PR produces one bounded stacked autofix path", async () => {
  const fixture = createSourceFixture();
  try {
    const dirtyPatch = fixture.patch;
    const manifest = createProvenance({
      repository,
      pullRequest,
      headRepository: repository,
      headRef,
      headSha: fixture.sha,
      patch: dirtyPatch
    });
    const calls = { push: [], create: [] };
    const result = await runPublish({
      repository,
      pullRequestNumber: pullRequest,
      headRepository: repository,
      headRef,
      headSha: fixture.sha,
      manifest,
      patch: dirtyPatch,
      sourceDirectory: fixture.directory,
      getCurrentPullRequest: async () =>
        currentPullRequest({
          head: {
            repo: { full_name: repository },
            ref: headRef,
            sha: fixture.sha
          }
        }),
      pushBranch: async (options) => calls.push.push(options),
      api: {
        async listOpenPullRequests({ head }) {
          assert.equal(
            head,
            `${repository.split("/")[0]}:autofix/prettier/pr-${pullRequest}`
          );
          return [];
        },
        async createPullRequest(options) {
          calls.create.push(options);
          return { number: 91 };
        }
      }
    });

    assert.equal(result.status, "published");
    assert.equal(result.branch, "autofix/prettier/pr-42");
    assert.equal(result.action, "created");
    assert.deepEqual(
      calls.push.map(({ branch }) => branch),
      ["autofix/prettier/pr-42"]
    );
    assert.equal(calls.create[0].head, "autofix/prettier/pr-42");
    assert.equal(calls.create[0].base, headRef);
    assert.equal(
      git(fixture.directory, ["rev-parse", "HEAD"], {
        encoding: "utf8"
      }).trim(),
      fixture.sha,
      "the source branch is not committed or advanced"
    );
    assert.equal(
      git(fixture.directory, ["diff", "--cached", "--name-only"], {
        encoding: "utf8"
      }).trim(),
      "src/example.js"
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("capture emits a bounded patch and provenance handoff for dirty source", () => {
  const fixture = createSourceFixture();
  const runnerTemp = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-runner-")
  );
  const outputPath = path.join(runnerTemp, "github-output");
  try {
    writeFileSync(
      path.join(fixture.directory, "src/example.js"),
      'const value = "x";\n'
    );
    execFileSync(
      process.execPath,
      [path.resolve("scripts/prettier-autofix/capture.mjs")],
      {
        cwd: fixture.directory,
        env: {
          ...process.env,
          GITHUB_WORKSPACE: fixture.directory,
          RUNNER_TEMP: runnerTemp,
          GITHUB_OUTPUT: outputPath,
          GITHUB_REPOSITORY: repository,
          SOURCE_PR_NUMBER: String(pullRequest),
          SOURCE_HEAD_REPOSITORY: repository,
          SOURCE_HEAD_REF: headRef,
          SOURCE_HEAD_SHA: fixture.sha,
          GITHUB_RUN_ID: "987654",
          GITHUB_RUN_ATTEMPT: "1"
        }
      }
    );
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /changed=true/u);
    const directory = output.match(/^directory=(.+)$/mu)?.[1];
    assert.ok(directory);
    assert.deepEqual(readdirSync(directory).sort(), [
      "patch.diff",
      "provenance.json"
    ]);
    const capturedPatch = readFileSync(path.join(directory, "patch.diff"));
    const capturedProvenance = JSON.parse(
      readFileSync(path.join(directory, "provenance.json"), "utf8")
    );
    assert.deepEqual(
      validateProvenance({
        manifest: capturedProvenance,
        patch: capturedPatch,
        expected: {
          repository,
          pullRequest,
          headRepository: repository,
          headRef,
          headSha: fixture.sha
        }
      }),
      []
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test("clean formatter output creates no artifact, provenance, or writer output", () => {
  const fixture = createSourceFixture();
  const runnerTemp = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-runner-")
  );
  const outputPath = path.join(runnerTemp, "github-output");
  try {
    execFileSync(
      process.execPath,
      [path.resolve("scripts/prettier-autofix/capture.mjs")],
      {
        cwd: fixture.directory,
        env: {
          ...process.env,
          GITHUB_WORKSPACE: fixture.directory,
          RUNNER_TEMP: runnerTemp,
          GITHUB_OUTPUT: outputPath,
          GITHUB_REPOSITORY: repository,
          SOURCE_PR_NUMBER: String(pullRequest),
          SOURCE_HEAD_REPOSITORY: repository,
          SOURCE_HEAD_REF: headRef,
          SOURCE_HEAD_SHA: fixture.sha,
          GITHUB_RUN_ID: "987655",
          GITHUB_RUN_ATTEMPT: "1"
        }
      }
    );
    assert.equal(readFileSync(outputPath, "utf8"), "changed=false\n");
    assert.deepEqual(readdirSync(runnerTemp), ["github-output"]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test("external fork PR is skipped before source reads, writes, or token-dependent calls", async () => {
  let operations = 0;
  const result = await runPublish({
    repository,
    pullRequestNumber: pullRequest,
    headRepository: "contributor/example",
    headRef,
    headSha,
    manifest: null,
    patch: Buffer.alloc(0),
    sourceDirectory: "/not-used",
    getCurrentPullRequest: async () => {
      operations += 1;
      throw new Error("must not inspect an external fork PR");
    },
    pushBranch: async () => {
      operations += 1;
    },
    api: {
      async listOpenPullRequests() {
        operations += 1;
        throw new Error("must not use the App API for an external fork");
      },
      async createPullRequest() {
        operations += 1;
        throw new Error("must not create a PR for an external fork");
      }
    }
  });
  assert.deepEqual(result, { status: "skipped", reason: "external-fork" });
  assert.equal(operations, 0);
});

test("autofix-origin PRs are excluded from recursive remediation", () => {
  assert.deepEqual(
    evaluateEligibility({
      repository,
      headRepository: repository,
      headRef: "autofix/prettier/pr-42"
    }),
    { eligible: false, reason: "autofix-recursion" }
  );
});

test("text patch paths and provenance are validated against exact PR provenance", () => {
  assert.deepEqual(validatePatch(patch), {
    files: ["src/example.js"],
    changedLines: 2,
    bytes: patch.byteLength
  });
  assert.deepEqual(
    validateProvenance({
      manifest: provenance(),
      patch,
      expected: {
        repository,
        pullRequest,
        headRepository: repository,
        headRef,
        headSha
      }
    }),
    []
  );
  assert.match(
    validateProvenance({
      manifest: provenance(),
      patch: Buffer.from(patch.toString().replace("'x'", "'y'")),
      expected: {
        repository,
        pullRequest,
        headRepository: repository,
        headRef,
        headSha
      }
    }).join(" "),
    /digest does not match/
  );
});

test("malformed, binary, delete, rename, submodule, and outside-checkout patches fail closed", () => {
  for (const unsafe of [
    "not a unified diff\n",
    "diff --git a/file b/file\nGIT binary patch\nopaque\n",
    "diff --git a/file b/file\nrename from file\nrename to other\n",
    "diff --git a/file b/file\nnew file mode 100644\n--- /dev/null\n+++ b/file\n@@ -0,0 +1 @@\n+x\n",
    "diff --git a/file b/file\ndeleted file mode 100644\n--- a/file\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n",
    "diff --git a/../outside b/../outside\n--- a/../outside\n+++ b/../outside\n@@ -1 +1 @@\n-a\n+b\n",
    "diff --git a/vendor b/vendor\nindex 1111111..2222222 160000\n--- a/vendor\n+++ b/vendor\n@@ -1 +1 @@\n-Subproject commit a\n+Subproject commit b\n"
  ]) {
    assert.throws(() => validatePatch(unsafe));
  }
});

test("symlink patch targets fail before git apply", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-symlink-")
  );
  try {
    writeFileSync(path.join(directory, "outside.txt"), "not a target\n");
    symlinkSync("outside.txt", path.join(directory, "src-link.js"));
    const symlinkPatch = Buffer.from(
      [
        "diff --git a/src-link.js b/src-link.js",
        "--- a/src-link.js",
        "+++ b/src-link.js",
        "@@ -1 +1 @@",
        "-outside.txt",
        "+changed.txt",
        ""
      ].join("\n")
    );
    assert.throws(
      () => assertRegularPatchTargets(directory, symlinkPatch),
      /symlink patch targets are not permitted/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stale SHA, changed head ref, closed PR, and fork head fail before branch push", async () => {
  const fixture = createSourceFixture();
  try {
    const dirtyPatch = fixture.patch;
    const manifest = createProvenance({
      repository,
      pullRequest,
      headRepository: repository,
      headRef,
      headSha: fixture.sha,
      patch: dirtyPatch
    });
    for (const changed of [
      {
        head: {
          repo: { full_name: repository },
          ref: headRef,
          sha: "b".repeat(40)
        }
      },
      {
        head: {
          repo: { full_name: repository },
          ref: "fix/42-other",
          sha: fixture.sha
        }
      },
      {
        state: "closed",
        head: {
          repo: { full_name: repository },
          ref: headRef,
          sha: fixture.sha
        }
      },
      {
        head: {
          repo: { full_name: "contributor/example" },
          ref: headRef,
          sha: fixture.sha
        }
      }
    ]) {
      let pushed = false;
      await assert.rejects(
        runPublish({
          repository,
          pullRequestNumber: pullRequest,
          headRepository: repository,
          headRef,
          headSha: fixture.sha,
          manifest,
          patch: dirtyPatch,
          sourceDirectory: fixture.directory,
          getCurrentPullRequest: async () => currentPullRequest(changed),
          pushBranch: async () => {
            pushed = true;
          },
          api: {
            async listOpenPullRequests() {
              return [];
            }
          }
        })
      );
      assert.equal(pushed, false);
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("writer updates only the deterministic autofix branch using a lease", () => {
  const fixture = createSourceFixture();
  const remote = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-remote-")
  );
  const runnerTemp = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-runner-")
  );
  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    git(fixture.directory, ["remote", "add", "origin", remote]);
    git(fixture.directory, ["push", "origin", `HEAD:refs/heads/${headRef}`]);
    git(fixture.directory, ["checkout", "--detach", fixture.sha]);
    writeFileSync(
      path.join(fixture.directory, "src/example.js"),
      'const value = "x";\n'
    );
    const formattedPatch = git(
      fixture.directory,
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "HEAD",
        "--"
      ],
      { encoding: "buffer" }
    );
    git(fixture.directory, ["checkout", "--", "src/example.js"]);

    for (const runId of ["first", "retry"]) {
      execFileSync("git", ["reset", "--hard", fixture.sha], {
        cwd: fixture.directory
      });
      execFileSync("git", ["apply", "--index"], {
        cwd: fixture.directory,
        input: formattedPatch
      });
      pushGeneratedBranch({
        sourceDirectory: fixture.directory,
        branch: "autofix/prettier/pr-42",
        appToken: "deterministic-test-token",
        pullRequestNumber: String(pullRequest),
        runnerTemp,
        runId
      });
    }

    const sourceRemoteSha = execFileSync(
      "git",
      ["--git-dir", remote, "rev-parse", `refs/heads/${headRef}`],
      { encoding: "utf8" }
    ).trim();
    const autofixSha = execFileSync(
      "git",
      ["--git-dir", remote, "rev-parse", "refs/heads/autofix/prettier/pr-42"],
      { encoding: "utf8" }
    ).trim();
    const autofixParent = execFileSync(
      "git",
      ["--git-dir", remote, "rev-parse", `${autofixSha}^`],
      { encoding: "utf8" }
    ).trim();
    assert.equal(sourceRemoteSha, fixture.sha);
    assert.equal(autofixParent, fixture.sha);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test("retry reuses the deterministic open PR instead of creating a duplicate", async () => {
  const open = [];
  const apiCalls = { create: 0, update: 0 };
  const api = {
    async listOpenPullRequests() {
      return [...open];
    },
    async createPullRequest(input) {
      apiCalls.create += 1;
      assert.equal(input.head, "autofix/prettier/pr-42");
      assert.equal(input.base, headRef);
      const created = {
        number: 91,
        head: { repo: { full_name: repository }, ref: input.head },
        base: { ref: input.base }
      };
      open.push(created);
      return created;
    },
    async updatePullRequest() {
      apiCalls.update += 1;
    }
  };
  const input = {
    api,
    repository,
    sourcePullRequest: {
      number: pullRequest,
      head: { ref: headRef, sha: headSha }
    },
    branch: "autofix/prettier/pr-42"
  };
  assert.deepEqual(await upsertAutofixPullRequest(input), {
    action: "created",
    number: 91
  });
  assert.deepEqual(await upsertAutofixPullRequest(input), {
    action: "reused",
    number: 91
  });
  assert.deepEqual(apiCalls, { create: 1, update: 0 });
});
