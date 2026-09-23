#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertCurrentPullRequest,
  evaluateEligibility,
  upsertAutofixPullRequest,
  validateProvenance
} from "./lib.mjs";
import {
  createAutofixCommit,
  initializeBareRepository,
  pushGeneratedBranch
} from "./git-tree.mjs";

export async function runPublish({
  repository,
  pullRequestNumber,
  headRepository,
  headRef,
  headSha,
  defaultBranch,
  providerRepository,
  providerWorkflowSha,
  manifest,
  patch,
  gitDirectory,
  indexPath,
  remoteUrl,
  runnerTemp,
  runId,
  readToken,
  getCurrentPullRequest,
  pushBranch,
  api
}) {
  const eligibility = evaluateEligibility({
    repository,
    headRepository,
    headRef
  });
  if (!eligibility.eligible) {
    return { status: "skipped", reason: eligibility.reason };
  }

  const expected = {
    repository,
    pullRequest: pullRequestNumber,
    headRepository,
    headRef,
    headSha,
    defaultBranch,
    providerRepository,
    providerWorkflowSha
  };
  const provenanceErrors = validateProvenance({ manifest, patch, expected });
  if (provenanceErrors.length > 0) throw new Error(provenanceErrors.join("; "));

  const validateCurrent = async () => {
    const current = await getCurrentPullRequest();
    assertCurrentPullRequest({
      pullRequest: current,
      repository,
      number: pullRequestNumber,
      headRepository,
      headRef,
      headSha
    });
    return current;
  };
  await validateCurrent();

  const gitRepository = initializeBareRepository({
    directory: gitDirectory,
    remoteUrl,
    readToken,
    pullRequestNumber,
    headSha,
    runnerTemp,
    runId
  });
  const prepared = createAutofixCommit({
    directory: gitRepository.directory,
    headSha,
    patch,
    indexPath,
    pullRequestNumber
  });

  const sourcePullRequest = await validateCurrent();
  const branch = `autofix/prettier/pr-${pullRequestNumber}`;
  await pushBranch({
    directory: gitRepository.directory,
    branch,
    commit: prepared.commit
  });
  const pullRequest = await upsertAutofixPullRequest({
    api,
    repository,
    sourcePullRequest,
    branch
  });
  return {
    status: "published",
    branch,
    commit: prepared.commit,
    ...pullRequest
  };
}

if (process.argv[1]?.endsWith("publish.mjs")) {
  await main();
}

async function main() {
  for (const name of [
    "GITHUB_REPOSITORY",
    "GITHUB_API_URL",
    "GITHUB_SERVER_URL",
    "GITHUB_TOKEN",
    "AUTOFIX_APP_TOKEN",
    "AUTOFIX_ARTIFACT_DIR",
    "AUTOFIX_GIT_DIRECTORY",
    "AUTOFIX_INDEX_PATH",
    "SOURCE_PR_NUMBER",
    "SOURCE_HEAD_REPOSITORY",
    "SOURCE_HEAD_REF",
    "SOURCE_HEAD_SHA",
    "FORMATTER_DEFAULT_BRANCH",
    "TRUSTED_PROVIDER_REPOSITORY",
    "TRUSTED_PROVIDER_SHA",
    "RUNNER_TEMP",
    "GITHUB_RUN_ID"
  ]) {
    if (!process.env[name]) throw new Error(`${name} is required`);
  }

  const expected = {
    repository: process.env.GITHUB_REPOSITORY,
    pullRequest: Number(process.env.SOURCE_PR_NUMBER),
    headRepository: process.env.SOURCE_HEAD_REPOSITORY,
    headRef: process.env.SOURCE_HEAD_REF,
    headSha: process.env.SOURCE_HEAD_SHA,
    defaultBranch: process.env.FORMATTER_DEFAULT_BRANCH,
    providerRepository: process.env.TRUSTED_PROVIDER_REPOSITORY,
    providerWorkflowSha: process.env.TRUSTED_PROVIDER_SHA
  };
  const patch = readFileSync(
    join(process.env.AUTOFIX_ARTIFACT_DIR, "patch.diff")
  );
  const manifest = JSON.parse(
    readFileSync(
      join(process.env.AUTOFIX_ARTIFACT_DIR, "provenance.json"),
      "utf8"
    )
  );
  const api = createApi({
    apiUrl: process.env.GITHUB_API_URL,
    repository: expected.repository,
    appToken: process.env.AUTOFIX_APP_TOKEN
  });
  const result = await runPublish({
    ...expected,
    pullRequestNumber: expected.pullRequest,
    manifest,
    patch,
    gitDirectory: process.env.AUTOFIX_GIT_DIRECTORY,
    indexPath: process.env.AUTOFIX_INDEX_PATH,
    remoteUrl: repositoryRemote(),
    runnerTemp: process.env.RUNNER_TEMP,
    runId: process.env.GITHUB_RUN_ID,
    readToken: process.env.GITHUB_TOKEN,
    getCurrentPullRequest: () =>
      api.getPullRequest(expected.pullRequest, process.env.GITHUB_TOKEN),
    pushBranch: ({ directory, branch, commit }) =>
      pushGeneratedBranch({
        directory,
        branch,
        commit,
        appToken: process.env.AUTOFIX_APP_TOKEN,
        runnerTemp: process.env.RUNNER_TEMP,
        runId: process.env.GITHUB_RUN_ID
      }),
    api
  });
  console.log(JSON.stringify(result));
}

function repositoryRemote() {
  const server = process.env.GITHUB_SERVER_URL.replace(/\/$/u, "");
  return `${server}/${process.env.GITHUB_REPOSITORY}.git`;
}

function createApi({ apiUrl, repository, appToken }) {
  const root = apiUrl.replace(/\/$/u, "");
  const request = async (method, path, body) => {
    const response = await fetch(`${root}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${appToken}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const responseBody = await response.text();
    if (!response.ok) {
      const error = new Error(
        `GitHub API ${method} ${path} failed (HTTP ${response.status})`
      );
      error.status = response.status;
      error.response = responseBody;
      throw error;
    }
    return responseBody === "" ? null : JSON.parse(responseBody);
  };
  const repoPath = `/repos/${repository}`;
  const [owner] = repository.split("/");
  return {
    getPullRequest(number, token) {
      return requestWithToken(root, repoPath, number, token);
    },
    async listOpenPullRequests({ head }) {
      const query = new URLSearchParams({ state: "open", head });
      return request("GET", `${repoPath}/pulls?${query}`);
    },
    updatePullRequest({ number, base }) {
      return request("PATCH", `${repoPath}/pulls/${number}`, { base });
    },
    async createPullRequest({ title, body, head, base }) {
      try {
        return await request("POST", `${repoPath}/pulls`, {
          title,
          body,
          head,
          base
        });
      } catch (cause) {
        if (cause.status !== 422) throw cause;
        const query = new URLSearchParams({
          state: "open",
          head: `${owner}:${head}`
        });
        const concurrent = await request("GET", `${repoPath}/pulls?${query}`);
        if (concurrent.length === 1) return concurrent[0];
        throw cause;
      }
    }
  };
}

async function requestWithToken(root, repoPath, number, token) {
  const response = await fetch(`${root}${repoPath}/pulls/${number}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error(
      `failed to re-read source pull request (HTTP ${response.status})`
    );
  }
  return response.json();
}
