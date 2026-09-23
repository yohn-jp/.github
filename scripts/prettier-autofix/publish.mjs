#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  assertCurrentPullRequest,
  assertRegularPatchTargets,
  evaluateEligibility,
  upsertAutofixPullRequest,
  validatePatch,
  validateProvenance
} from "./lib.mjs";

export async function runPublish({
  repository,
  pullRequestNumber,
  headRepository,
  headRef,
  headSha,
  manifest,
  patch,
  sourceDirectory,
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
    headSha
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

  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceDirectory,
    encoding: "utf8"
  }).trim();
  if (checkoutSha !== headSha) {
    throw new Error("source checkout does not match the provenance head SHA");
  }
  assertRegularPatchTargets(sourceDirectory, patch);
  execFileSync("git", ["apply", "--check", "--index"], {
    cwd: sourceDirectory,
    input: patch
  });
  execFileSync("git", ["apply", "--index"], {
    cwd: sourceDirectory,
    input: patch
  });

  const files = new Set(
    execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
      cwd: sourceDirectory,
      encoding: "utf8"
    })
      .split("\0")
      .filter(Boolean)
  );
  const validatedFiles = new Set(validatePatch(patch).files);
  if (
    files.size !== validatedFiles.size ||
    [...files].some((file) => !validatedFiles.has(file))
  ) {
    throw new Error(
      "applied patch changed files outside its validated text diff"
    );
  }
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "-z"],
    {
      cwd: sourceDirectory,
      encoding: "utf8"
    }
  );
  if (status.includes("?? ")) {
    throw new Error(
      "source checkout contains untracked files; refusing autofix write"
    );
  }

  const sourcePullRequest = await validateCurrent();
  const branch = `autofix/prettier/pr-${pullRequestNumber}`;
  await pushBranch({
    sourceDirectory,
    branch,
    pullRequestNumber,
    headSha,
    headRef
  });
  const pullRequest = await upsertAutofixPullRequest({
    api,
    repository,
    sourcePullRequest,
    branch
  });
  return { status: "published", branch, ...pullRequest };
}

if (process.argv[1]?.endsWith("publish.mjs")) {
  await main();
}

async function main() {
  for (const name of [
    "GITHUB_REPOSITORY",
    "GITHUB_API_URL",
    "GITHUB_TOKEN",
    "AUTOFIX_APP_TOKEN",
    "AUTOFIX_ARTIFACT_DIR",
    "SOURCE_PR_NUMBER",
    "SOURCE_HEAD_REPOSITORY",
    "SOURCE_HEAD_REF",
    "SOURCE_HEAD_SHA",
    "SOURCE_CHECKOUT"
  ]) {
    if (!process.env[name]) throw new Error(`${name} is required`);
  }

  const expected = {
    repository: process.env.GITHUB_REPOSITORY,
    pullRequest: Number(process.env.SOURCE_PR_NUMBER),
    headRepository: process.env.SOURCE_HEAD_REPOSITORY,
    headRef: process.env.SOURCE_HEAD_REF,
    headSha: process.env.SOURCE_HEAD_SHA
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
    repository: expected.repository,
    pullRequestNumber: expected.pullRequest,
    headRepository: expected.headRepository,
    headRef: expected.headRef,
    headSha: expected.headSha,
    manifest,
    patch,
    sourceDirectory: process.env.SOURCE_CHECKOUT,
    getCurrentPullRequest: () =>
      api.getPullRequest(expected.pullRequest, process.env.GITHUB_TOKEN),
    pushBranch: ({ sourceDirectory, branch }) =>
      pushGeneratedBranch({
        sourceDirectory,
        branch,
        appToken: process.env.AUTOFIX_APP_TOKEN
      }),
    api
  });
  console.log(JSON.stringify(result));
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

export function pushGeneratedBranch({
  sourceDirectory,
  branch,
  appToken,
  pullRequestNumber = process.env.SOURCE_PR_NUMBER,
  runnerTemp = process.env.RUNNER_TEMP,
  runId = process.env.GITHUB_RUN_ID
}) {
  const askpass = join(runnerTemp, `prettier-autofix-askpass-${runId}`);
  writeFileSync(
    askpass,
    "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf 'x-access-token\\n' ;;\n  *) printf '%s\\n' \"$AUTOFIX_APP_TOKEN\" ;;\nesac\n",
    { mode: 0o700 }
  );
  chmodSync(askpass, 0o700);
  const env = {
    ...process.env,
    AUTOFIX_APP_TOKEN: appToken,
    GIT_ASKPASS: askpass,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0"
  };
  const git = (args, options = {}) =>
    execFileSync("git", ["-c", "credential.helper=", ...args], {
      cwd: sourceDirectory,
      env,
      ...options
    });

  git(
    [
      "-c",
      "user.name=Prettier Autofix",
      "-c",
      "user.email=prettier-autofix@users.noreply.github.com",
      "commit",
      "-m",
      `style: format PR #${pullRequestNumber}`
    ],
    { stdio: "ignore" }
  );

  const ref = `refs/heads/${branch}`;
  const remote = git(["ls-remote", "--heads", "origin", ref], {
    encoding: "utf8"
  }).trim();
  const expected = remote === "" ? "" : remote.split(/\s+/u)[0];
  if (remote !== "" && !/^[a-f0-9]{40}\s+refs\/heads\//u.test(remote)) {
    throw new Error("remote autofix branch lookup returned an unexpected ref");
  }
  git(
    ["push", `--force-with-lease=${ref}:${expected}`, "origin", `HEAD:${ref}`],
    { stdio: "inherit" }
  );
}
