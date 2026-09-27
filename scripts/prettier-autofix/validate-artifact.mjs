#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  assertCurrentPullRequest,
  evaluateEligibility,
  validateProvenance
} from "./lib.mjs";
import {
  checkPatchAgainstBareRepository,
  initializeBareRepository
} from "./git-tree.mjs";

const required = [
  "AUTOFIX_ARTIFACT_DIR",
  "AUTOFIX_GIT_DIRECTORY",
  "AUTOFIX_INDEX_PATH",
  "GITHUB_API_URL",
  "GITHUB_SERVER_URL",
  "GITHUB_REPOSITORY",
  "GITHUB_TOKEN",
  "GITHUB_RUN_ID",
  "RUNNER_TEMP",
  "SOURCE_PR_NUMBER",
  "SOURCE_HEAD_REPOSITORY",
  "SOURCE_HEAD_REF",
  "SOURCE_HEAD_SHA",
  "FORMATTER_DEFAULT_BRANCH",
  "TRUSTED_PROVIDER_REPOSITORY",
  "TRUSTED_PROVIDER_SHA"
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const expected = expectedProvenance();
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

const gitDirectory = initializeBareRepository({
  directory: process.env.AUTOFIX_GIT_DIRECTORY,
  remoteUrl: repositoryRemote(),
  readToken: process.env.GITHUB_TOKEN,
  pullRequestNumber: expected.pullRequest,
  headSha: expected.headSha,
  runnerTemp: process.env.RUNNER_TEMP,
  runId: process.env.GITHUB_RUN_ID
});
const files = checkPatchAgainstBareRepository({
  directory: gitDirectory.directory,
  headSha: expected.headSha,
  patch,
  indexPath: process.env.AUTOFIX_INDEX_PATH
});
console.log(
  `Trusted formatter provenance and ${files.length} text patch target(s) validated against the exact source Git tree; no PR checkout or code execution occurred.`
);

function expectedProvenance() {
  return {
    repository: process.env.GITHUB_REPOSITORY,
    pullRequest: Number(process.env.SOURCE_PR_NUMBER),
    headRepository: process.env.SOURCE_HEAD_REPOSITORY,
    headRef: process.env.SOURCE_HEAD_REF,
    headSha: process.env.SOURCE_HEAD_SHA,
    defaultBranch: process.env.FORMATTER_DEFAULT_BRANCH,
    providerRepository: process.env.TRUSTED_PROVIDER_REPOSITORY,
    providerWorkflowSha: process.env.TRUSTED_PROVIDER_SHA
  };
}

function repositoryRemote() {
  const server = process.env.GITHUB_SERVER_URL.replace(/\/$/u, "");
  return `${server}/${process.env.GITHUB_REPOSITORY}.git`;
}

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
