#!/usr/bin/env node
// Consumer-oriented contract test for the class of defect reported in
// yohn-jp/gh-makami PR #13: a reusable workflow in this repository (the
// provider) resolving its OWN tooling (scripts, composite actions) against
// the CALLER's repository/ref instead of the exact yohn-jp/.github revision
// the caller pinned to. That failure only manifests when the caller
// repository differs from the provider repository, so `github.sha` (the
// caller's checked-out commit) is never a safe substitute for the
// provider's own commit, and a same-repository self-test cannot detect a
// regression here (github.sha and the provider commit coincide there).
// This script instead inspects workflow YAML directly for the two known
// failure shapes, both structural, so it fails on the "not our ref"
// checkout below regardless of which repository triggers the run:
//
//   1. A step that checks out this repository (`repository: yohn-jp/.github`,
//      or the equivalent self-reference in yohn-jp/.github's own workflows)
//      must resolve `ref:` from `job.workflow_repository` / `job.workflow_sha`
//      (the GitHub Actions fields that identify the exact provider revision
//      a caller pinned to). It must never resolve from `github.sha` (the
//      caller's own commit) or from `github.job_workflow_ref` (not a real
//      context field — see yohn-jp/.github#18).
//   2. A `uses: ./...` local composite-action reference inside a reusable
//      workflow's job STEPS resolves against the caller's checked-out
//      workspace, not this provider repository, so it must point into a
//      path that was populated by a checkout of this provider repository
//      (i.e. a `path:` used by a step matching rule 1), never directly at
//      `./.github/actions/...`. This does not apply to job-level
//      `jobs.<id>.uses: ./path/to/workflow.yml` references to another
//      reusable workflow FILE in this same repository: GitHub resolves
//      those against the repository/commit that defines the calling
//      workflow file, which is already this provider repository at the
//      caller-pinned commit, so they are safe as-is.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const UNSAFE_REF_EXPRESSIONS = [
  { pattern: /github\.sha/, reason: "github.sha is the CALLER's checked-out commit, not this provider's" },
  { pattern: /github\.job_workflow_ref/, reason: "github.job_workflow_ref is not a real GitHub Actions context field" },
];
const SAFE_REF_EXPRESSION = /job\.workflow_sha/;
const SAFE_REPOSITORY_EXPRESSION = /job\.workflow_repository/;

/**
 * @param {unknown} doc parsed workflow YAML
 * @param {string} sourceLabel path used in error messages
 * @returns {string[]} errors
 */
export function validateProviderToolingResolution(doc, sourceLabel) {
  const errors = [];
  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object") {
    return errors;
  }

  // Paths populated by a checkout step that correctly resolves this
  // provider repository at the caller-pinned commit (rule 1 satisfied).
  const providerCheckoutPaths = new Set();

  for (const [jobId, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    // Concatenation of every step's env/run/with in this job, so a ref that
    // is computed indirectly (e.g. a prior step writes $GITHUB_OUTPUT from
    // an unsafe expression, and the checkout step reads that step output)
    // is still inspected for the unsafe expressions it was built from.
    const jobSource = JSON.stringify(steps);

    for (const [i, step] of steps.entries()) {
      if (typeof step?.uses !== "string" || !step.uses.startsWith("actions/checkout")) continue;
      const withBlock = step.with ?? {};
      const repository = withBlock.repository;
      if (typeof repository !== "string") continue; // checking out the caller's own repo; not provider tooling

      const where = `${sourceLabel}:jobs.${jobId}.steps[${i}]`;
      const refExpr = String(withBlock.ref ?? "");
      const isDirectSafeForm = SAFE_REF_EXPRESSION.test(refExpr) && SAFE_REPOSITORY_EXPRESSION.test(repository);

      if (!isDirectSafeForm) {
        let matchedUnsafePattern = false;
        for (const { pattern, reason } of UNSAFE_REF_EXPRESSIONS) {
          if (pattern.test(refExpr) || pattern.test(jobSource)) {
            matchedUnsafePattern = true;
            errors.push(`${where}: provider tooling checkout in job "${jobId}" — ${reason}`);
          }
        }
        errors.push(
          `${where}: provider tooling checkout (repository: "${repository}", ref: "${refExpr}") must resolve ` +
            `repository from job.workflow_repository and ref from job.workflow_sha directly, the exact provider ` +
            `revision the caller pinned to` +
            (matchedUnsafePattern ? "" : " (found an indirect or unrecognized ref expression)"),
        );
      } else if (typeof withBlock.path === "string") {
        providerCheckoutPaths.add(withBlock.path);
      }
    }
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    for (const [i, step] of steps.entries()) {
      if (typeof step?.uses !== "string") continue;
      const ref = step.uses;
      if (!ref.startsWith("./") && !ref.startsWith("../")) continue;

      const where = `${sourceLabel}:jobs.${jobId}.steps[${i}]`;
      const matchesProviderCheckout = [...providerCheckoutPaths].some(
        (path) => ref === `./${path}` || ref.startsWith(`./${path}/`),
      );
      if (!matchesProviderCheckout) {
        errors.push(
          `${where}: local action reference "${ref}" resolves against the CALLER's checked-out workspace, not ` +
            `this provider repository, when this workflow is invoked cross-repository; it must point into a path ` +
            `checked out from job.workflow_repository/job.workflow_sha`,
        );
      }
    }
  }

  return errors;
}

/**
 * Verify that provider-owned files leave the consumer workspace before
 * consumer commands run, and that metadata tooling is installed from the
 * provider checkout rather than from a nested consumer workspace.
 *
 * actions/checkout deliberately only accepts paths below GITHUB_WORKSPACE,
 * so workflows that need a provider-local composite action must first check
 * it out into the workspace, invoke that action, and then move the checkout
 * to RUNNER_TEMP. Metadata validation has no local-action dependency, but it
 * follows the same move and uses the resulting absolute path for pnpm.
 *
 * @param {unknown} doc parsed workflow YAML
 * @param {string} sourceLabel path used in error messages
 * @returns {string[]} errors
 */
export function validateProviderToolingIsolation(doc, sourceLabel) {
  const errors = [];
  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object") {
    return errors;
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];

    for (const [i, step] of steps.entries()) {
      if (typeof step?.uses !== "string" || !step.uses.startsWith("actions/checkout")) continue;
      const withBlock = step.with ?? {};
      if (!SAFE_REPOSITORY_EXPRESSION.test(String(withBlock.repository ?? ""))) continue;
      if (!SAFE_REF_EXPRESSION.test(String(withBlock.ref ?? ""))) continue;

      const checkoutPath = String(withBlock.path ?? "");
      if (!checkoutPath) continue;
      const escapedPath = checkoutPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const movePattern = new RegExp(`\\bmv\\s+${escapedPath}\\s+[\"']?\\$RUNNER_TEMP/`);
      const moveIndex = steps.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > i && typeof candidate?.run === "string" && movePattern.test(candidate.run),
      );
      const where = `${sourceLabel}:jobs.${jobId}.steps[${i}]`;

      if (moveIndex < 0) {
        errors.push(
          `${where}: provider checkout path "${checkoutPath}" must be moved under $RUNNER_TEMP before consumer commands run`,
        );
      }

      // The metadata workflow installs the provider package itself. Its pnpm
      // setup and install paths must both point at the moved provider tree;
      // a relative path would still allow pnpm to discover the consumer's
      // ancestor workspace configuration.
      if (!checkoutPath.includes("metadata-tools")) continue;
      const installStep = steps.find(
        (candidate) => typeof candidate?.run === "string" && /pnpm\s+install\s+--frozen-lockfile/.test(candidate.run),
      );
      if (installStep) {
        const workingDirectory = String(installStep["working-directory"] ?? "");
        if (!/runner\.temp|\$RUNNER_TEMP/.test(workingDirectory) || !workingDirectory.includes("metadata-tools")) {
          errors.push(
            `${where}: provider dependency installation must use the moved metadata-tools directory under runner.temp`,
          );
        }
      }

      const setupStep = steps.find(
        (candidate) =>
          typeof candidate?.uses === "string" &&
          candidate.uses.startsWith("pnpm/action-setup") &&
          typeof candidate.with?.package_json_file === "string",
      );
      if (setupStep) {
        const packageJsonFile = String(setupStep.with.package_json_file);
        if (!/runner\.temp|\$RUNNER_TEMP/.test(packageJsonFile) || !packageJsonFile.includes("metadata-tools")) {
          errors.push(
            `${where}: pnpm setup must read package_json_file from the moved metadata-tools directory under runner.temp`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * @param {string} filePath
 * @returns {string[]} errors
 */
export function validateProviderToolingResolutionFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (cause) {
    return [`${filePath}: invalid YAML: ${cause.message}`];
  }
  return [
    ...validateProviderToolingResolution(doc, filePath),
    ...validateProviderToolingIsolation(doc, filePath),
  ];
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function collectTargets(root) {
  const targets = [];
  const workflowsDir = join(root, ".github", "workflows");
  if (existsSync(workflowsDir)) {
    for (const name of readdirSync(workflowsDir)) {
      if (name.endsWith(".yml") || name.endsWith(".yaml")) {
        targets.push(join(workflowsDir, name));
      }
    }
  }
  return targets;
}

function main() {
  const targets = collectTargets(process.cwd());

  if (targets.length === 0) {
    console.log("No workflow files found; nothing to validate.");
    return;
  }

  let failed = false;
  for (const target of targets) {
    const errors = validateProviderToolingResolutionFile(target);
    if (errors.length === 0) {
      console.log(`OK   ${target}`);
    } else {
      failed = true;
      console.log(`FAIL ${target}`);
      for (const e of errors) {
        console.log(`     ${e}`);
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (isMain()) {
  main();
}
