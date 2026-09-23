import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { validatePatch } from "./lib.mjs";

const ASKPASS =
  "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf 'x-access-token\\n' ;;\n  *) printf '%s\\n' \"$GIT_HTTP_TOKEN\" ;;\nesac\n";

export function initializeBareRepository({
  directory,
  remoteUrl,
  readToken,
  pullRequestNumber,
  headSha,
  runnerTemp,
  runId
}) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("source pull request number is invalid");
  }
  if (!/^[a-f0-9]{40}$/u.test(headSha)) {
    throw new Error("source pull request SHA is invalid");
  }
  if (typeof readToken !== "string" || readToken.length === 0) {
    throw new Error("read-only GitHub token is required to fetch source data");
  }
  if (
    typeof remoteUrl !== "string" ||
    (!/^https:\/\//u.test(remoteUrl) && !/^file:\/\/\//u.test(remoteUrl))
  ) {
    throw new Error("source repository remote must use HTTPS");
  }

  mkdirSync(runnerTemp, { recursive: true });
  mkdirSync(directory, { recursive: false });
  execFileSync("git", ["init", "--bare", "--quiet", directory], {
    cwd: runnerTemp,
    stdio: "ignore"
  });
  git(directory, ["remote", "add", "origin", remoteUrl]);

  const askpass = writeAskpass(runnerTemp, runId);
  try {
    const fetched = git(
      directory,
      [
        "fetch",
        "--no-tags",
        "--depth=1",
        "origin",
        `refs/pull/${pullRequestNumber}/head`
      ],
      {
        env: credentialEnvironment(readToken, askpass),
        encoding: "utf8"
      }
    ).trim();
    const actualSha = git(directory, ["rev-parse", "FETCH_HEAD"], {
      encoding: "utf8"
    }).trim();
    if (actualSha !== headSha) {
      throw new Error(
        "fetched source PR head changed from the observed provenance SHA"
      );
    }
    if (
      git(directory, ["cat-file", "-t", headSha], {
        encoding: "utf8"
      }).trim() !== "commit"
    ) {
      throw new Error("source PR head is not a commit object");
    }
    return { directory, headSha, fetched };
  } finally {
    rmSync(askpass, { force: true });
  }
}

export function checkPatchAgainstBareRepository({
  directory,
  headSha,
  patch,
  indexPath
}) {
  const files = assertPatchTargetsInGitTree(directory, headSha, patch);
  const env = { GIT_INDEX_FILE: indexPath };
  git(directory, ["read-tree", headSha], { env });
  git(directory, ["apply", "--cached", "--check"], {
    env,
    input: patch,
    stdio: ["pipe", "ignore", "pipe"]
  });
  return files;
}

export function createAutofixCommit({
  directory,
  headSha,
  patch,
  indexPath,
  pullRequestNumber
}) {
  const files = assertPatchTargetsInGitTree(directory, headSha, patch);
  const env = { GIT_INDEX_FILE: indexPath };
  git(directory, ["read-tree", headSha], { env });
  git(directory, ["apply", "--cached", "--check"], {
    env,
    input: patch,
    stdio: ["pipe", "ignore", "pipe"]
  });
  git(directory, ["apply", "--cached"], {
    env,
    input: patch,
    stdio: ["pipe", "ignore", "pipe"]
  });

  const tree = git(directory, ["write-tree"], { env, encoding: "utf8" }).trim();
  const changedFiles = git(
    directory,
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", headSha, tree],
    { encoding: "buffer" }
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (
    changedFiles.length !== files.length ||
    files.some((file) => !changedFiles.includes(file))
  ) {
    throw new Error("applied patch tree differs from the validated file set");
  }

  const sourceDate = git(directory, ["show", "-s", "--format=%cI", headSha], {
    encoding: "utf8"
  }).trim();
  const commit = git(
    directory,
    [
      "commit-tree",
      tree,
      "-p",
      headSha,
      "-m",
      `style: format PR #${pullRequestNumber}`
    ],
    {
      env: {
        GIT_AUTHOR_NAME: "Prettier Autofix",
        GIT_AUTHOR_EMAIL: "prettier-autofix@users.noreply.github.com",
        GIT_COMMITTER_NAME: "Prettier Autofix",
        GIT_COMMITTER_EMAIL: "prettier-autofix@users.noreply.github.com",
        GIT_AUTHOR_DATE: sourceDate,
        GIT_COMMITTER_DATE: sourceDate
      },
      encoding: "utf8"
    }
  ).trim();
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error("Git did not create a valid autofix commit");
  }
  return { commit, tree, files };
}

export function assertPatchTargetsInGitTree(directory, headSha, patch) {
  const { files } = validatePatch(patch);
  for (const file of files) {
    const components = file.split("/");
    for (let index = 1; index < components.length; index += 1) {
      const parent = components.slice(0, index).join("/");
      const entries = treeEntries(directory, headSha, parent, false);
      if (
        entries.length !== 1 ||
        entries[0].path !== parent ||
        entries[0].mode !== "040000" ||
        entries[0].type !== "tree"
      ) {
        throw new Error(`patch parent is not a regular directory: ${parent}`);
      }
    }
    const entries = treeEntries(directory, headSha, file, true);
    if (
      entries.length !== 1 ||
      entries[0].path !== file ||
      !["100644", "100755"].includes(entries[0].mode) ||
      entries[0].type !== "blob"
    ) {
      throw new Error(`patch target is not a regular source file: ${file}`);
    }
  }
  return files;
}

export function pushGeneratedBranch({
  directory,
  branch,
  commit,
  appToken,
  runnerTemp,
  runId
}) {
  if (!/^autofix\/prettier\/pr-\d+$/u.test(branch)) {
    throw new Error("autofix branch name is not deterministic or safe");
  }
  if (typeof appToken !== "string" || appToken.length === 0) {
    throw new Error("GitHub App token is required to push the autofix branch");
  }
  const askpass = writeAskpass(runnerTemp, runId);
  try {
    const env = credentialEnvironment(appToken, askpass);
    const ref = `refs/heads/${branch}`;
    const remote = git(directory, ["ls-remote", "--heads", "origin", ref], {
      env,
      encoding: "utf8"
    }).trim();
    const expected = remote === "" ? "" : remote.split(/\s+/u)[0];
    if (
      remote !== "" &&
      !new RegExp(`^[a-f0-9]{40}\\s+${escapeRegExp(ref)}$`, "u").test(remote)
    ) {
      throw new Error(
        "remote autofix branch lookup returned an unexpected ref"
      );
    }
    git(
      directory,
      [
        "push",
        `--force-with-lease=${ref}:${expected}`,
        "origin",
        `${commit}:${ref}`
      ],
      { env, stdio: "inherit" }
    );
  } finally {
    rmSync(askpass, { force: true });
  }
}

function treeEntries(directory, revision, path, recursive) {
  const args = ["--literal-pathspecs", "ls-tree", "-z"];
  if (recursive) args.push("-r");
  args.push("--full-tree", revision, "--", path);
  const output = git(directory, args, { encoding: "buffer" });
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      if (tab < 0) throw new Error("git returned a malformed tree entry");
      const [mode, type] = entry.slice(0, tab).split(" ");
      return { mode, type, path: entry.slice(tab + 1) };
    });
}

function git(directory, args, options = {}) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...options.env
  };
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  const { env: ignored, ...execOptions } = options;
  return execFileSync("git", ["--git-dir", directory, ...args], {
    cwd: directory,
    env,
    maxBuffer: 8 * 1024 * 1024,
    ...execOptions
  });
}

function writeAskpass(directory, identifier) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `prettier-autofix-askpass-${identifier}`);
  writeFileSync(path, ASKPASS, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function credentialEnvironment(token, askpass) {
  return {
    GIT_HTTP_TOKEN: token,
    GIT_ASKPASS: askpass,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0"
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
