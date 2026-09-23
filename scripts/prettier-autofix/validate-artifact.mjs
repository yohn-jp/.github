#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  assertCurrentPullRequest,
  assertRegularPatchTargets,
  evaluateEligibility,
  validateProvenance
} from "./lib.mjs";

const required = [
  "AUTOFIX_ARTIFACT_DIR",
  "GITHUB_API_URL",
  "GITHUB_REPOSITORY",
  "GITHUB_TOKEN",
  "SOURCE_PR_NUMBER",
  "SOURCE_HEAD_REPOSITORY",
  "SOURCE_HEAD_REF",
  "SOURCE_HEAD_SHA",
  "SOURCE_CHECKOUT"
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const expected = {
  repository: process.env.GITHUB_REPOSITORY,
  pullRequest: Number(process.env.SOURCE_PR_NUMBER),
  headRepository: process.env.SOURCE_HEAD_REPOSITORY,
  headRef: process.env.SOURCE_HEAD_REF,
  headSha: process.env.SOURCE_HEAD_SHA
};
const eligibility = evaluateEligibility({
  repository: expected.repository,
  headRepository: expected.headRepository,
  headRef: expected.headRef
});
if (!eligibility.eligible) {
  throw new Error(`autofix is not eligible: ${eligibility.reason}`);
}

const directory = process.env.AUTOFIX_ARTIFACT_DIR;
const artifactFiles = readdirSync(directory).sort();
if (
  JSON.stringify(artifactFiles) !==
  JSON.stringify(["patch.diff", "provenance.json"])
) {
  throw new Error("artifact must contain only patch.diff and provenance.json");
}
for (const name of artifactFiles) {
  const stat = lstatSync(join(directory, name));
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`artifact entry is not a regular file: ${name}`);
  }
}
const patchPath = join(directory, "patch.diff");
const manifestPath = join(directory, "provenance.json");
if (lstatSync(patchPath).size > 5 * 1024 * 1024) {
  throw new Error("patch exceeds the size limit");
}
if (lstatSync(manifestPath).size > 16 * 1024) {
  throw new Error("provenance exceeds the size limit");
}
const patch = readFileSync(patchPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = validateProvenance({ manifest, patch, expected });
if (errors.length > 0) throw new Error(errors.join("; "));

const pullRequest = await getPullRequest({
  apiUrl: process.env.GITHUB_API_URL,
  repository: expected.repository,
  number: expected.pullRequest,
  token: process.env.GITHUB_TOKEN
});
assertCurrentPullRequest({
  pullRequest,
  repository: expected.repository,
  number: expected.pullRequest,
  headRepository: expected.headRepository,
  headRef: expected.headRef,
  headSha: expected.headSha
});

const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: process.env.SOURCE_CHECKOUT,
  encoding: "utf8"
}).trim();
if (checkoutSha !== expected.headSha) {
  throw new Error("source checkout does not match the provenance head SHA");
}
assertRegularPatchTargets(process.env.SOURCE_CHECKOUT, patch);
execFileSync("git", ["apply", "--check", "--index"], {
  cwd: process.env.SOURCE_CHECKOUT,
  input: patch,
  stdio: ["pipe", "ignore", "pipe"]
});
console.log(
  "Patch provenance, source PR head, and non-writing apply check are valid."
);

async function getPullRequest({ apiUrl, repository, number, token }) {
  const response = await fetch(
    `${apiUrl.replace(/\/$/u, "")}/repos/${repository}/pulls/${number}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28"
      }
    }
  );
  if (!response.ok) {
    throw new Error(
      `failed to re-read source pull request (HTTP ${response.status})`
    );
  }
  return response.json();
}
