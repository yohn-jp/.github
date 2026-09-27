import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBranchName,
  validateBranchName
} from "../scripts/validate-branch-name.mjs";
import * as canonicalBranchNaming from "gh-inari/branch-naming";

const releaseSourceRevision = "0123456789abcdef0123456789abcdef01234567";

test("default pattern accepts a conventional branch name", () => {
  assert.deepEqual(validateBranchName("feat/42-add-init-command"), []);
});

test("default pattern rejects a branch missing the issue number", () => {
  const errors = validateBranchName("feat/add-init-command");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match required pattern/);
});

test("default pattern accepts a release branch without an Issue number", () => {
  assert.deepEqual(
    validateBranchName("release/0.5.1", {
      sourceRevision: releaseSourceRevision
    }),
    []
  );
  assert.deepEqual(
    classifyBranchName("release/0.5.1", {
      sourceRevision: releaseSourceRevision
    }),
    {
      kind: "release",
      valid: true,
      version: "0.5.1",
      errors: []
    }
  );
});

test("a release branch accepts a complete prerelease and build semver", () => {
  assert.deepEqual(
    validateBranchName("release/1.0.0-rc.1+build.7", {
      sourceRevision: releaseSourceRevision
    }),
    []
  );
});

test("malformed release branches are rejected explicitly", () => {
  for (const branch of ["release/foo", "release/0.5"]) {
    const errors = validateBranchName(branch, {
      sourceRevision: releaseSourceRevision
    });
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /Release target version must be a semantic version/
    );
    assert.equal(
      classifyBranchName(branch, {
        sourceRevision: releaseSourceRevision
      }).kind,
      "invalid-release"
    );
  }
});

test("default pattern rejects an unknown type prefix", () => {
  const errors = validateBranchName("feature/42-add-init-command");
  assert.equal(errors.length, 1);
});

test("main is exempt by default", () => {
  assert.deepEqual(validateBranchName("main"), []);
});

test("exempt list waives only the narrower legacy pattern for canonical branches", () => {
  const pattern = "^feat/\\d+-[a-z0-9-]+$";
  assert.equal(
    validateBranchName("chore/42-bump-tooling", { pattern }).length,
    1
  );
  assert.deepEqual(
    validateBranchName("chore/42-bump-tooling", {
      pattern,
      exempt: ["main", "chore/42-bump-tooling"]
    }),
    []
  );
  assert.equal(
    classifyBranchName("chore/42-bump-tooling", {
      pattern,
      exempt: ["chore/42-bump-tooling"]
    }).kind,
    "exempt"
  );
});

test("exempt ordinary branches cannot bypass canonical Inari validation", () => {
  for (const branch of ["develop", "feat/abc", "dependabot/npm/x"]) {
    assert.ok(canonicalBranchNaming.validateBranchName(branch).length > 0);
    const errors = validateBranchName(branch, {
      pattern: ".*",
      exempt: ["main", branch]
    });
    assert.equal(errors.length, 1, branch);
    assert.match(errors[0], /does not match/u);
  }
});

test("pattern is configurable", () => {
  assert.deepEqual(
    validateBranchName("release/1.2.3", {
      pattern: "^release/\\d+\\.\\d+\\.\\d+$",
      sourceRevision: releaseSourceRevision
    }),
    []
  );
  assert.equal(
    validateBranchName("feat/42-add-init-command", {
      pattern: "^release/\\d+\\.\\d+\\.\\d+$"
    }).length,
    1
  );
});

test("an ordinary Issue-less feature branch remains rejected", () => {
  assert.equal(validateBranchName("fix/foo").length, 1);
});

test("overlong branch name is rejected before regex compilation", () => {
  const errors = validateBranchName(`feat/1-${"a".repeat(300)}`);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exceeds the maximum supported length/);
});

test("an overlong epic branch is rejected as invalid-epic before regex compilation", () => {
  const branch = `epic/1-${"a".repeat(300)}`;
  const errors = validateBranchName(branch);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exceeds the maximum supported length/);
  assert.equal(classifyBranchName(branch).kind, "invalid-epic");
});

test("overlong configured pattern is rejected before regex compilation", () => {
  const errors = validateBranchName("feat/1-x", {
    pattern: `^(${"a|".repeat(150)}z)$`
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /exceeds the maximum supported length/);
});

test("an invalid configured pattern fails closed with a clear diagnostic", () => {
  const errors = validateBranchName("feat/1-x", { pattern: "(unterminated" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is not a valid regular expression/);
});

test("a valid release branch passes even with a malformed configured ordinary pattern", () => {
  assert.deepEqual(
    validateBranchName("release/0.5.1", {
      pattern: "[invalid",
      sourceRevision: releaseSourceRevision
    }),
    []
  );
  assert.equal(
    classifyBranchName("release/0.5.1", {
      pattern: "[invalid",
      sourceRevision: releaseSourceRevision
    }).kind,
    "release"
  );
});

test("a valid release branch passes even with an overlong configured ordinary pattern", () => {
  assert.deepEqual(
    validateBranchName("release/0.5.1", {
      pattern: `^(${"a|".repeat(150)}z)$`,
      sourceRevision: releaseSourceRevision
    }),
    []
  );
});

test("a malformed release branch is rejected as invalid-release even with a broad configured ordinary pattern", () => {
  const result = classifyBranchName("release/foo", {
    pattern: ".*",
    sourceRevision: releaseSourceRevision
  });
  assert.equal(result.kind, "invalid-release");
  assert.equal(result.valid, false);
  assert.match(
    result.errors[0],
    /Release target version must be a semantic version/
  );
});

test("a malformed release branch is rejected as invalid-release even with a malformed configured ordinary pattern", () => {
  const result = classifyBranchName("release/foo", {
    pattern: "[invalid",
    sourceRevision: releaseSourceRevision
  });
  assert.equal(result.kind, "invalid-release");
  assert.match(
    result.errors[0],
    /Release target version must be a semantic version/
  );
});

test("release prefix cannot be overridden by branch-name-exempt", () => {
  const errors = validateBranchName("release/foo", {
    exempt: ["release/foo"],
    sourceRevision: releaseSourceRevision
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Release target version must be a semantic version/);
});

test("default pattern accepts a canonical epic integration branch", () => {
  assert.deepEqual(validateBranchName("epic/890-runtime-certification"), []);
  assert.deepEqual(classifyBranchName("epic/890-runtime-certification"), {
    kind: "epic",
    valid: true,
    issueNumber: "890",
    slug: "runtime-certification",
    errors: []
  });
});

test("a malformed epic branch is rejected explicitly", () => {
  for (const branch of [
    "epic/foo",
    "epic/890",
    "epic/-runtime-certification"
  ]) {
    const errors = validateBranchName(branch);
    assert.equal(errors.length, 1);
    assert.deepEqual(errors, canonicalBranchNaming.validateBranchName(branch));
    assert.equal(classifyBranchName(branch).kind, "invalid-epic");
  }
});

test("a valid epic branch passes even with a malformed configured ordinary pattern", () => {
  assert.deepEqual(
    validateBranchName("epic/890-runtime-certification", {
      pattern: "[invalid"
    }),
    []
  );
  assert.equal(
    classifyBranchName("epic/890-runtime-certification", {
      pattern: "[invalid"
    }).kind,
    "epic"
  );
});

test("a valid epic branch passes even with an overlong configured ordinary pattern", () => {
  assert.deepEqual(
    validateBranchName("epic/890-runtime-certification", {
      pattern: `^(${"a|".repeat(150)}z)$`
    }),
    []
  );
});

test("a malformed epic branch is rejected as invalid-epic even with a broad configured ordinary pattern", () => {
  const result = classifyBranchName("epic/foo", { pattern: ".*" });
  assert.equal(result.kind, "invalid-epic");
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors,
    canonicalBranchNaming.validateBranchName("epic/foo")
  );
});

test("epic prefix cannot be overridden by branch-name-exempt", () => {
  const errors = validateBranchName("epic/foo", {
    exempt: ["epic/foo"]
  });
  assert.equal(errors.length, 1);
  assert.deepEqual(
    errors,
    canonicalBranchNaming.validateBranchName("epic/foo")
  );
});

test("epic branches are never accepted by an unrelated ordinary pattern override", () => {
  const errors = validateBranchName("epic/890-runtime-certification", {
    pattern: "^release/\\d+\\.\\d+\\.\\d+$"
  });
  assert.deepEqual(errors, []);
});

test("canonical source-Issue branches bypass legacy ordinary regex configuration", () => {
  const errors = validateBranchName("issue/680-source-routing", {
    pattern: ".*",
    exempt: ["issue/680-source-routing"]
  });
  assert.equal(
    typeof canonicalBranchNaming.recognizeIntegrationBranchName,
    "function",
    "gh-inari #925 canonical integration branch recognition is required"
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(classifyBranchName("issue/680-source-routing"), {
    kind: "issue",
    valid: true,
    issueNumber: "680",
    slug: "source-routing",
    errors: []
  });
});

test("malformed source-Issue branches fail closed despite broad legacy configuration", () => {
  for (const branch of ["issue/foo", "issue/680", "issue/-source-routing"]) {
    const result = classifyBranchName(branch, {
      pattern: ".*",
      exempt: [branch]
    });
    assert.equal(result.kind, "invalid-issue");
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
  }
});
