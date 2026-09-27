import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
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
  createProvenance,
  evaluateEligibility,
  inspectFormatterAuthority,
  upsertAutofixPullRequest,
  validatePatch,
  validateProvenance
} from "../scripts/prettier-autofix/lib.mjs";
import { runPublish } from "../scripts/prettier-autofix/publish.mjs";
import {
  assertPatchTargetsInGitTree,
  checkPatchAgainstBareRepository,
  createAutofixCommit,
  initializeBareRepository,
  pushGeneratedBranch
} from "../scripts/prettier-autofix/git-tree.mjs";

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

const providerRepository = "yohn-jp/.github";
const providerWorkflowSha = "b".repeat(40);

function formatterAuthority(overrides = {}) {
  return {
    providerRepository,
    providerWorkflowSha,
    consumerRepository: repository,
    defaultBranch: "main",
    defaultSha: "c".repeat(40),
    packageJsonSha256: "d".repeat(64),
    lockfileSha256: "e".repeat(64),
    configSha256: "f".repeat(64),
    ignoreSha256: "1".repeat(64),
    packageManager: "pnpm@11.25.0",
    prettierVersion: "3.9.6",
    ...overrides
  };
}

function expectedProvenance(overrides = {}) {
  return {
    repository,
    pullRequest,
    headRepository: repository,
    headRef,
    headSha,
    defaultBranch: "main",
    providerRepository,
    providerWorkflowSha,
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
    formatterAuthority: formatterAuthority(),
    patch,
    ...overrides
  });
}

function git(directory, args, options = {}) {
  return execFileSync("git", args, { cwd: directory, ...options });
}

function writeFormatterAuthority(directory, authority = formatterAuthority()) {
  const output = path.join(directory, "formatter-authority.json");
  writeFileSync(output, `${JSON.stringify(authority)}\n`);
  return output;
}

function createBareRemote(fixture) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-remote-")
  );
  execFileSync("git", ["init", "--bare", directory], { stdio: "ignore" });
  git(fixture.directory, ["remote", "add", "origin", directory]);
  git(fixture.directory, ["push", "origin", `HEAD:refs/heads/${headRef}`], {
    stdio: "ignore"
  });
  execFileSync(
    "git",
    [
      "--git-dir",
      directory,
      "update-ref",
      `refs/pull/${pullRequest}/head`,
      fixture.sha
    ],
    { stdio: "ignore" }
  );
  return { directory, url: `file://${directory}` };
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

test("formatter authority availability distinguishes absence from malformed inputs", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-authority-")
  );
  try {
    assert.deepEqual(inspectFormatterAuthority(directory), {
      available: false,
      missing: [
        "package.json",
        "pnpm-lock.yaml",
        "prettier.config.mjs",
        ".prettierignore"
      ]
    });

    for (const name of [
      "package.json",
      "pnpm-lock.yaml",
      "prettier.config.mjs",
      ".prettierignore"
    ]) {
      writeFileSync(path.join(directory, name), "\n");
    }
    assert.deepEqual(inspectFormatterAuthority(directory), {
      available: true,
      missing: []
    });

    rmSync(path.join(directory, "prettier.config.mjs"));
    mkdirSync(path.join(directory, "prettier.config.mjs"));
    assert.throws(
      () => inspectFormatterAuthority(directory),
      /formatter authority input is not a regular file/u
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PR scripts, formatter config, dependencies, plugins, and ignore files cannot choose published text", () => {
  const workspace = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-trust-boundary-")
  );
  const source = path.join(workspace, "source");
  const authority = path.join(workspace, "formatter-authority");
  const marker = path.join(workspace, "untrusted-code-ran");
  const metadataPath = path.join(workspace, "formatter-authority.json");
  mkdirSync(source);
  mkdirSync(authority);
  try {
    writeFileSync(
      path.join(authority, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@11.25.0",
        devDependencies: { prettier: "3.9.6" }
      })
    );
    writeFileSync(
      path.join(authority, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n"
    );
    writeFileSync(
      path.join(authority, "prettier.config.mjs"),
      'export default { endOfLine: "lf", printWidth: 120, semi: true, singleQuote: false, trailingComma: "all" };\n'
    );
    writeFileSync(
      path.join(authority, ".prettierignore"),
      [
        "node_modules/",
        "package.json",
        "pnpm-lock.yaml",
        "prettier.config.mjs",
        ".prettierignore",
        ".editorconfig",
        "src/arbitrary.txt",
        "src/trusted-ignored.js"
      ].join("\n") + "\n"
    );
    writeFileSync(path.join(authority, ".gitignore"), "node_modules/\n");
    mkdirSync(path.join(authority, "node_modules"));
    symlinkSync(
      path.resolve("node_modules/prettier"),
      path.join(authority, "node_modules/prettier"),
      "dir"
    );
    git(authority, ["init", "-b", "main"]);
    git(authority, ["config", "user.name", "Trusted Authority"]);
    git(authority, ["config", "user.email", "trusted@example.invalid"]);
    git(authority, ["add", "."]);
    git(authority, ["commit", "-m", "trusted formatter authority"]);

    mkdirSync(path.join(source, "src"), { recursive: true });
    mkdirSync(path.join(source, "node_modules", "prettier", "bin"), {
      recursive: true
    });
    mkdirSync(path.join(source, "node_modules", "prettier-plugin-arbitrary"), {
      recursive: true
    });
    writeFileSync(
      path.join(source, "package.json"),
      JSON.stringify({
        scripts: {
          format: `node -e "require('fs').writeFileSync('src/arbitrary.txt', 'ARBITRARY FROM PR SCRIPT\\n')"`
        },
        devDependencies: {
          prettier: "file:untrusted-prettier",
          "prettier-plugin-arbitrary": "file:untrusted-plugin"
        }
      })
    );
    writeFileSync(
      path.join(source, "prettier.config.mjs"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "config executed");\nexport default { plugins: ["prettier-plugin-arbitrary"] };\n`
    );
    writeFileSync(path.join(source, ".prettierignore"), "src/target.js\n");
    writeFileSync(
      path.join(source, ".editorconfig"),
      "root = true\n[*]\nend_of_line = crlf\nindent_size = 8\nindent_style = tab\n"
    );
    writeFileSync(
      path.join(source, ".gitignore"),
      "node_modules/\nsrc/target.js\n"
    );
    writeFileSync(path.join(source, "src/target.js"), "const value='x'\n");
    writeFileSync(path.join(source, "src/trusted-ignored.js"), "const ignored='x'\n");
    writeFileSync(
      path.join(source, "src/arbitrary.txt"),
      "keep this non-canonical payload\n"
    );
    writeFileSync(
      path.join(source, "node_modules/prettier/bin/prettier.cjs"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "PR formatter executed");\n`
    );
    writeFileSync(
      path.join(source, "node_modules/prettier-plugin-arbitrary/index.mjs"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "PR plugin executed");\n`
    );
    git(source, ["init", "-b", headRef]);
    git(source, ["config", "user.name", "PR Author"]);
    git(source, ["config", "user.email", "pr@example.invalid"]);
    git(source, ["add", "."]);
    git(source, ["add", "-f", "src/target.js"]);
    git(source, ["commit", "-m", "untrusted formatter configuration"]);
    const sourceSha = git(source, ["rev-parse", "HEAD"], {
      encoding: "utf8"
    }).trim();

    execFileSync(
      process.execPath,
      [path.resolve("scripts/prettier-autofix/format.mjs")],
      {
        env: {
          ...process.env,
          FORMATTER_AUTHORITY_DIRECTORY: authority,
          FORMATTER_AUTHORITY_REF: "main",
          FORMATTER_AUTHORITY_OUTPUT: metadataPath,
          PROVIDER_REPOSITORY: providerRepository,
          PROVIDER_WORKFLOW_SHA: providerWorkflowSha,
          SOURCE_CHECKOUT: source,
          SOURCE_HEAD_SHA: sourceSha,
          GITHUB_REPOSITORY: repository,
          GITHUB_WORKSPACE: workspace
        }
      }
    );

    assert.equal(
      readFileSync(path.join(source, "src/target.js"), "utf8"),
      'const value = "x";\n'
    );
    assert.equal(
      readFileSync(path.join(source, "src/arbitrary.txt"), "utf8"),
      "keep this non-canonical payload\n"
    );
    assert.equal(
      readFileSync(path.join(source, "src/trusted-ignored.js"), "utf8"),
      "const ignored='x'\n"
    );
    assert.equal(existsSync(marker), false);
    const generatedPatch = git(
      source,
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
    assert.deepEqual(validatePatch(generatedPatch).files, ["src/target.js"]);
    const authorityMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    assert.equal(authorityMetadata.consumerRepository, repository);
    assert.equal(authorityMetadata.defaultBranch, "main");
    assert.equal(
      authorityMetadata.defaultSha,
      git(authority, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    );
    assert.equal(authorityMetadata.prettierVersion, "3.9.6");
    assert.match(authorityMetadata.packageJsonSha256, /^[a-f0-9]{64}$/u);
    assert.match(authorityMetadata.lockfileSha256, /^[a-f0-9]{64}$/u);
    assert.match(authorityMetadata.configSha256, /^[a-f0-9]{64}$/u);
    assert.match(authorityMetadata.ignoreSha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("same-repository dirty PR produces one bounded stacked autofix path", async () => {
  const fixture = createSourceFixture();
  const runnerTemp = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-runner-")
  );
  const remote = createBareRemote(fixture);
  try {
    const dirtyPatch = fixture.patch;
    const manifest = provenance({ headSha: fixture.sha, patch: dirtyPatch });
    const calls = { push: [], create: [] };
    const result = await runPublish({
      repository,
      pullRequestNumber: pullRequest,
      headRepository: repository,
      headRef,
      headSha: fixture.sha,
      defaultBranch: "main",
      providerRepository,
      providerWorkflowSha,
      manifest,
      patch: dirtyPatch,
      gitDirectory: path.join(runnerTemp, "writer.git"),
      indexPath: path.join(runnerTemp, "writer.index"),
      remoteUrl: remote.url,
      runnerTemp,
      runId: "run-42",
      readToken: "test-read-token",
      getCurrentPullRequest: async () =>
        currentPullRequest({
          head: {
            repo: { full_name: repository },
            ref: headRef,
            sha: fixture.sha
          }
        }),
      pushBranch: async (options) => {
        calls.push.push(options);
        pushGeneratedBranch({
          ...options,
          appToken: "test-app-token",
          runnerTemp,
          runId: "push-42"
        });
      },
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
      calls.create[0].title,
      "style(prettier): format feat/42-format-source (PR #42)"
    );
    assert.equal(
      git(fixture.directory, ["rev-parse", "HEAD"], {
        encoding: "utf8"
      }).trim(),
      fixture.sha,
      "the source branch is not committed or advanced"
    );
    const sourceRemoteSha = execFileSync(
      "git",
      ["--git-dir", remote.directory, "rev-parse", `refs/heads/${headRef}`],
      { encoding: "utf8" }
    ).trim();
    const autofixSha = execFileSync(
      "git",
      [
        "--git-dir",
        remote.directory,
        "rev-parse",
        "refs/heads/autofix/prettier/pr-42"
      ],
      { encoding: "utf8" }
    ).trim();
    assert.equal(sourceRemoteSha, fixture.sha);
    assert.equal(
      execFileSync(
        "git",
        ["--git-dir", remote.directory, "rev-parse", `${autofixSha}^`],
        { encoding: "utf8" }
      ).trim(),
      fixture.sha
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(remote.directory, { recursive: true, force: true });
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test("capture emits a bounded patch and provenance handoff for dirty source", () => {
  const fixture = createSourceFixture();
  const runnerTemp = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-runner-")
  );
  const outputPath = path.join(runnerTemp, "github-output");
  const authorityPath = writeFormatterAuthority(runnerTemp);
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
          SOURCE_CHECKOUT: fixture.directory,
          FORMATTER_AUTHORITY_OUTPUT: authorityPath,
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
        expected: expectedProvenance({ headSha: fixture.sha })
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
  const authorityPath = writeFormatterAuthority(runnerTemp);
  try {
    execFileSync(
      process.execPath,
      [path.resolve("scripts/prettier-autofix/capture.mjs")],
      {
        cwd: fixture.directory,
        env: {
          ...process.env,
          SOURCE_CHECKOUT: fixture.directory,
          FORMATTER_AUTHORITY_OUTPUT: authorityPath,
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
    assert.deepEqual(readdirSync(runnerTemp).sort(), [
      "formatter-authority.json",
      "github-output"
    ]);
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
      expected: expectedProvenance()
    }),
    []
  );
  assert.match(
    validateProvenance({
      manifest: provenance(),
      patch: Buffer.from(patch.toString().replace("'x'", "'y'")),
      expected: expectedProvenance()
    }).join(" "),
    /digest does not match/
  );
});

test("final-newline repair patches accept only old-side no-newline metadata", () => {
  const repaired = Buffer.from(
    [
      "diff --git a/src/example.js b/src/example.js",
      "index 1111111..2222222 100644",
      "--- a/src/example.js",
      "+++ b/src/example.js",
      "@@ -1 +1 @@",
      "-const value = 'x'",
      "\\ No newline at end of file",
      '+const value = "x";',
      ""
    ].join("\n")
  );

  assert.deepEqual(validatePatch(repaired), {
    files: ["src/example.js"],
    changedLines: 2,
    bytes: repaired.byteLength
  });

  for (const invalid of [
    [
      "diff --git a/src/example.js b/src/example.js",
      "--- a/src/example.js",
      "+++ b/src/example.js",
      "@@ -1 +1 @@",
      "\\ No newline at end of file",
      "-const value = 'x'",
      '+const value = "x";',
      ""
    ].join("\n"),
    [
      "diff --git a/src/example.js b/src/example.js",
      "--- a/src/example.js",
      "+++ b/src/example.js",
      "@@ -1 +1 @@",
      "-const value = 'x'",
      '+const value = "x";',
      "\\ No newline at end of file",
      ""
    ].join("\n")
  ]) {
    assert.throws(
      () => validatePatch(invalid),
      /patch without final newlines is not permitted/u
    );
  }
});

test("provenance rejects PR-controlled formatter commands and authority identities", () => {
  const manifest = provenance();
  const alteredCommand = {
    ...manifest,
    formatter: "pnpm run format"
  };
  assert.match(
    validateProvenance({
      manifest: alteredCommand,
      patch,
      expected: expectedProvenance()
    }).join(" "),
    /trusted Prettier CLI/u
  );

  const alteredDefaultBranch = {
    ...manifest,
    formatterAuthority: {
      ...manifest.formatterAuthority,
      defaultBranch: "pull-request-controlled"
    }
  };
  assert.match(
    validateProvenance({
      manifest: alteredDefaultBranch,
      patch,
      expected: expectedProvenance()
    }).join(" "),
    /default branch does not match/u
  );

  const alteredDependencies = {
    ...manifest,
    formatterAuthority: {
      ...manifest.formatterAuthority,
      lockfileSha256: "not-a-digest"
    }
  };
  assert.match(
    validateProvenance({
      manifest: alteredDependencies,
      patch,
      expected: expectedProvenance()
    }).join(" "),
    /lockfileSha256 is invalid/u
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

test("bare writer rejects symlink targets from the source Git tree", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-symlink-")
  );
  try {
    git(directory, ["init", "-b", "main"]);
    git(directory, ["config", "user.name", "Test Author"]);
    git(directory, ["config", "user.email", "test@example.invalid"]);
    writeFileSync(path.join(directory, "outside.txt"), "not a target\n");
    symlinkSync("outside.txt", path.join(directory, "src-link.js"));
    git(directory, ["add", "."]);
    git(directory, ["commit", "-m", "symlink source"]);
    const sourceSha = git(directory, ["rev-parse", "HEAD"], {
      encoding: "utf8"
    }).trim();
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
      () =>
        assertPatchTargetsInGitTree(
          path.join(directory, ".git"),
          sourceSha,
          symlinkPatch
        ),
      /patch target is not a regular source file/u
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stale SHA, changed head ref, closed PR, and fork head fail before branch push", async () => {
  const fixture = createSourceFixture();
  try {
    const dirtyPatch = fixture.patch;
    const manifest = provenance({ headSha: fixture.sha, patch: dirtyPatch });
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
          defaultBranch: "main",
          providerRepository,
          providerWorkflowSha,
          manifest,
          patch: dirtyPatch,
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

test("writer publishes a deterministic commit without checking out or mutating PR files", () => {
  const fixture = createSourceFixture();
  const remote = createBareRemote(fixture);
  const runnerTemp = mkdtempSync(
    path.join(os.tmpdir(), "prettier-autofix-runner-")
  );
  try {
    const gitRepository = initializeBareRepository({
      directory: path.join(runnerTemp, "writer.git"),
      remoteUrl: remote.url,
      readToken: "test-read-token",
      pullRequestNumber: pullRequest,
      headSha: fixture.sha,
      runnerTemp,
      runId: "fetch-42"
    });
    const indexPath = path.join(runnerTemp, "writer.index");
    assert.deepEqual(
      checkPatchAgainstBareRepository({
        directory: gitRepository.directory,
        headSha: fixture.sha,
        patch: fixture.patch,
        indexPath
      }),
      ["src/example.js"]
    );

    const commits = [];
    for (const runId of ["first", "retry"]) {
      const prepared = createAutofixCommit({
        directory: gitRepository.directory,
        headSha: fixture.sha,
        patch: fixture.patch,
        indexPath,
        pullRequestNumber: pullRequest
      });
      commits.push(prepared.commit);
      pushGeneratedBranch({
        directory: gitRepository.directory,
        branch: "autofix/prettier/pr-42",
        commit: prepared.commit,
        appToken: "deterministic-test-token",
        runnerTemp,
        runId
      });
    }

    const sourceRemoteSha = execFileSync(
      "git",
      ["--git-dir", remote.directory, "rev-parse", `refs/heads/${headRef}`],
      { encoding: "utf8" }
    ).trim();
    const autofixSha = execFileSync(
      "git",
      [
        "--git-dir",
        remote.directory,
        "rev-parse",
        "refs/heads/autofix/prettier/pr-42"
      ],
      { encoding: "utf8" }
    ).trim();
    const autofixParent = execFileSync(
      "git",
      ["--git-dir", remote.directory, "rev-parse", `${autofixSha}^`],
      { encoding: "utf8" }
    ).trim();
    assert.equal(sourceRemoteSha, fixture.sha);
    assert.equal(autofixParent, fixture.sha);
    assert.equal(commits[0], commits[1]);
    assert.equal(autofixSha, commits[1]);
    assert.equal(
      git(fixture.directory, ["rev-parse", "HEAD"], {
        encoding: "utf8"
      }).trim(),
      fixture.sha
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
    rmSync(remote.directory, { recursive: true, force: true });
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
