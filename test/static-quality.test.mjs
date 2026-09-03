import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateActionPinsFile } from "../scripts/validate-action-pins.mjs";
import { validateProviderToolingResolutionFile } from "../scripts/validate-provider-tooling-resolution.mjs";
import {
  StaticQualityError,
  applyConsumerFilters,
  analyzeStaticQuality,
  normalizeToolReport,
  runStaticQualityGate,
  validateStaticQualityConfig
} from "../scripts/static-quality-gate.mjs";

function fixture(name) {
  return join("test", "fixtures", "static-quality", name);
}

function loadConfig(name) {
  const root = fixture(name);
  return yaml.load(readFileSync(join(root, "static-quality.yml"), "utf8"));
}

test("provider static-quality analyzer passes a clean configured fixture", () => {
  const root = fixture("pass");
  const report = runStaticQualityGate({
    repositoryRoot: root,
    configFile: "static-quality.yml"
  });
  assert.deepEqual(report["new-findings"], []);
  assert.equal(report.findings.length, 0);
});

test("provider static-quality analyzer reports dead code and maintainability violations", () => {
  const root = fixture("fail");
  const report = runStaticQualityGate({
    repositoryRoot: root,
    configFile: "static-quality.yml"
  });
  const rules = new Set(report["new-findings"].map((finding) => finding.rule));
  assert.ok(rules.has("dead-code/file"));
  assert.ok(rules.has("dead-code/export"));
  assert.ok(rules.has("dead-code/dependency"));
  assert.ok(rules.has("maintainability/complexity"));
  assert.ok(rules.has("maintainability/max-lines-per-function"));
  assert.ok(rules.has("maintainability/max-depth"));
  assert.ok(rules.has("maintainability/max-params"));
  assert.equal(
    report["new-findings"].every(
      (finding) =>
        finding.file && finding.rule && finding.line && finding.message
    ),
    true
  );
});

test("baseline suppresses known debt while leaving a new violation blocking", () => {
  const root = fixture("fail");
  const report = runStaticQualityGate({
    repositoryRoot: root,
    configFile: "static-quality.yml",
    baselineFile: "baseline.yml"
  });
  assert.equal(report["new-findings"].length, 0);
  assert.equal(report.baseline.suppressed, report.findings.length);

  const baseline = yaml.load(readFileSync(join(root, "baseline.yml"), "utf8"));
  baseline.findings.pop();
  const partialBaseline = join(root, "partial-baseline.yml");
  writeFileSync(partialBaseline, yaml.dump(baseline) + "\n");
  try {
    const regression = runStaticQualityGate({
      repositoryRoot: root,
      configFile: "static-quality.yml",
      baselineFile: "partial-baseline.yml"
    });
    assert.ok(regression["new-findings"].length > 0);
  } finally {
    rmSync(partialBaseline);
  }
});

test("consumer-owned file, export, and dependency exceptions are explicit filters", () => {
  const root = fixture("fail");
  const config = loadConfig("fail");
  config.exceptions = {
    files: ["src/orphan.js"],
    exports: ["src/helper.js:unused"],
    dependencies: ["unused-package"]
  };
  const findings = applyConsumerFilters(
    analyzeStaticQuality({ root, config }),
    config
  ).filter((finding) => finding.rule.startsWith("dead-code/"));
  assert.deepEqual(findings, []);
});

test("malformed consumer configuration fails closed with deterministic diagnostics", () => {
  const root = fixture("malformed");
  const config = yaml.load(
    readFileSync(join(root, "static-quality.yml"), "utf8")
  );
  const errors = validateStaticQualityConfig(config, "malformed.yml");
  assert.ok(errors.some((error) => error.includes("schema-version must be 1")));
  assert.ok(
    errors.some((error) => error.includes("entry-points must be a non-empty"))
  );
  assert.ok(
    errors.some((error) => error.includes("maintainability.parameters"))
  );
  assert.throws(
    () =>
      runStaticQualityGate({
        repositoryRoot: root,
        configFile: "static-quality.yml"
      }),
    (error) => error instanceof StaticQualityError
  );
});

test("static-quality workflow exposes the contract without matrices or repository coupling", () => {
  const workflowPath = ".github/workflows/static-quality.yml";
  const source = readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  const call = workflow.on.workflow_call;
  assert.ok(call);
  assert.deepEqual(Object.keys(call.inputs).sort(), [
    "baseline-file",
    "check-command",
    "config-file",
    "execution-mode",
    "working-directory"
  ]);
  assert.equal(call.outputs.status.value, "${{ jobs.status.outputs.status }}");
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.jobs.check["runs-on"], "ubuntu-latest");
  assert.deepEqual(workflow.jobs.check.permissions, { contents: "read" });
  assert.equal(workflow.jobs.status.if, "always()");
  assert.doesNotMatch(source, /strategy:/u);
  assert.doesNotMatch(source, /github\.repository(?:_owner)?/u);
  assert.match(source, /Knip/iu);
  assert.match(source, /ESLint/iu);
  assert.deepEqual(validateActionPinsFile(workflowPath), []);
  assert.deepEqual(validateProviderToolingResolutionFile(workflowPath), []);
});

test("consumer reports can use the stable static-quality format", () => {
  const findings = normalizeToolReport(
    JSON.stringify({
      "schema-version": 1,
      findings: [
        {
          kind: "maintainability",
          rule: "maintainability/complexity",
          file: "src/index.ts",
          line: 8,
          column: 3,
          message: "complexity exceeds the configured limit"
        }
      ]
    }),
    fixture("pass")
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "src/index.ts");
  assert.equal(findings[0].rule, "maintainability/complexity");
  assert.match(findings[0].fingerprint, /src\/index\.ts/);
});

test("consumer Knip JSON is normalized from its grouped reporter shape", () => {
  const findings = normalizeToolReport(
    JSON.stringify({
      files: ["src/orphan.js"],
      issues: [
        {
          file: "src/helper.js",
          exports: [{ name: "unused", line: 5, col: 1 }],
          dependencies: [{ name: "unused-package", line: 6, col: 5 }]
        }
      ]
    }),
    fixture("fail")
  );
  assert.deepEqual(findings.map((finding) => finding.rule).sort(), [
    "dead-code/dependency",
    "dead-code/export",
    "dead-code/file"
  ]);
  assert.equal(findings[1].file, "src/helper.js");
});
