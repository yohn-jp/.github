import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const MAX_PATCH_BYTES = 5 * 1024 * 1024;
export const FORMATTER_ID = "trusted-default-branch-prettier-v1";
const MAX_PATCH_FILES = 200;
const SHA256 = /^[a-f0-9]{64}$/u;
const HEAD_SHA = /^[a-f0-9]{40}$/u;

export function evaluateEligibility({ repository, headRepository, headRef }) {
  if (
    typeof repository !== "string" ||
    typeof headRepository !== "string" ||
    typeof headRef !== "string"
  ) {
    return { eligible: false, reason: "invalid-pull-request-context" };
  }
  if (repository.toLowerCase() !== headRepository.toLowerCase()) {
    return { eligible: false, reason: "external-fork" };
  }
  if (headRef.startsWith("autofix/prettier/pr-")) {
    return { eligible: false, reason: "autofix-recursion" };
  }
  return { eligible: true, reason: "eligible" };
}

export function preparePatchHandoff({
  repository,
  pullRequest,
  headRepository,
  headRef,
  headSha,
  formatterAuthority,
  patch
}) {
  const patchBuffer = Buffer.isBuffer(patch) ? patch : Buffer.from(patch);
  if (patchBuffer.byteLength === 0) return { changed: false };
  validatePatch(patchBuffer);
  return {
    changed: true,
    patch: patchBuffer,
    provenance: createProvenance({
      repository,
      pullRequest,
      headRepository,
      headRef,
      headSha,
      formatterAuthority,
      patch: patchBuffer
    })
  };
}

export function createProvenance({
  repository,
  pullRequest,
  headRepository,
  headRef,
  headSha,
  formatterAuthority,
  patch
}) {
  const patchBuffer = Buffer.isBuffer(patch) ? patch : Buffer.from(patch);
  return {
    schemaVersion: 2,
    repository,
    pullRequest,
    headRepository,
    headRef,
    headSha,
    formatter: FORMATTER_ID,
    formatterAuthority,
    patchBytes: patchBuffer.byteLength,
    patchSha256: createHash("sha256").update(patchBuffer).digest("hex")
  };
}

export function validateProvenance({ manifest, patch, expected }) {
  const patchBuffer = Buffer.isBuffer(patch) ? patch : Buffer.from(patch);
  const errors = [];
  const keys = [
    "schemaVersion",
    "repository",
    "pullRequest",
    "headRepository",
    "headRef",
    "headSha",
    "formatter",
    "formatterAuthority",
    "patchBytes",
    "patchSha256"
  ].sort();

  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    return ["provenance must be a JSON object"];
  }
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(keys)) {
    errors.push("provenance has missing or unexpected fields");
  }
  if (manifest.schemaVersion !== 2)
    errors.push("unsupported provenance schema");
  if (manifest.formatter !== FORMATTER_ID) {
    errors.push(
      "provenance formatter identity is not the trusted Prettier CLI"
    );
  }
  errors.push(
    ...validateFormatterAuthority(manifest.formatterAuthority, expected)
  );
  if (!Number.isSafeInteger(manifest.pullRequest) || manifest.pullRequest < 1) {
    errors.push("provenance pull request number is invalid");
  }
  if (
    typeof manifest.repository !== "string" ||
    !manifest.repository.includes("/")
  ) {
    errors.push("provenance repository is invalid");
  }
  if (
    typeof manifest.headRepository !== "string" ||
    !manifest.headRepository.includes("/")
  ) {
    errors.push("provenance head repository is invalid");
  }
  if (
    typeof manifest.headRef !== "string" ||
    manifest.headRef.length === 0 ||
    manifest.headRef.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(manifest.headRef)
  ) {
    errors.push("provenance head ref is invalid");
  }
  if (
    typeof manifest.headSha !== "string" ||
    !HEAD_SHA.test(manifest.headSha)
  ) {
    errors.push("provenance head SHA is invalid");
  }
  if (
    !Number.isSafeInteger(manifest.patchBytes) ||
    manifest.patchBytes !== patchBuffer.byteLength
  ) {
    errors.push("provenance patch size does not match the artifact");
  }
  if (
    typeof manifest.patchSha256 !== "string" ||
    !SHA256.test(manifest.patchSha256)
  ) {
    errors.push("provenance patch digest is invalid");
  } else if (
    createHash("sha256").update(patchBuffer).digest("hex") !==
    manifest.patchSha256
  ) {
    errors.push("provenance patch digest does not match the artifact");
  }

  for (const field of [
    "repository",
    "pullRequest",
    "headRepository",
    "headRef",
    "headSha"
  ]) {
    if (manifest[field] !== expected[field]) {
      errors.push(`provenance ${field} does not match the trusted event`);
    }
  }
  if (
    manifest.headRepository?.toLowerCase() !==
    manifest.repository?.toLowerCase()
  ) {
    errors.push("external fork patches are not eligible for autofix");
  }

  try {
    validatePatch(patchBuffer);
  } catch (cause) {
    errors.push(cause.message);
  }
  return errors;
}

function validateFormatterAuthority(authority, expected) {
  const errors = [];
  const keys = [
    "providerRepository",
    "providerWorkflowSha",
    "consumerRepository",
    "defaultBranch",
    "defaultSha",
    "packageJsonSha256",
    "lockfileSha256",
    "configSha256",
    "ignoreSha256",
    "packageManager",
    "prettierVersion"
  ].sort();
  if (
    authority === null ||
    typeof authority !== "object" ||
    Array.isArray(authority)
  ) {
    return ["formatter authority must be a JSON object"];
  }
  if (JSON.stringify(Object.keys(authority).sort()) !== JSON.stringify(keys)) {
    errors.push("formatter authority has missing or unexpected fields");
  }
  if (authority.consumerRepository !== expected.repository) {
    errors.push(
      "formatter consumer repository does not match the trusted event"
    );
  }
  if (authority.defaultBranch !== expected.defaultBranch) {
    errors.push("formatter default branch does not match the trusted event");
  }
  if (authority.providerRepository !== expected.providerRepository) {
    errors.push(
      "formatter provider repository does not match the trusted workflow"
    );
  }
  if (authority.providerWorkflowSha !== expected.providerWorkflowSha) {
    errors.push("formatter provider SHA does not match the trusted workflow");
  }
  for (const field of ["providerRepository", "consumerRepository"]) {
    const parts =
      typeof authority[field] === "string" ? authority[field].split("/") : [];
    if (
      parts.length !== 2 ||
      parts.some(
        (part) =>
          part.length === 0 ||
          /\s/u.test(part) ||
          /[\u0000-\u001f\u007f]/u.test(part)
      )
    ) {
      errors.push(`formatter ${field} is invalid`);
    }
  }
  if (
    typeof authority.defaultBranch !== "string" ||
    authority.defaultBranch.length === 0 ||
    authority.defaultBranch.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(authority.defaultBranch)
  ) {
    errors.push("formatter default branch is invalid");
  }
  for (const field of ["providerWorkflowSha", "defaultSha"]) {
    if (
      typeof authority[field] !== "string" ||
      !HEAD_SHA.test(authority[field])
    ) {
      errors.push(`formatter ${field} is invalid`);
    }
  }
  for (const field of [
    "packageJsonSha256",
    "lockfileSha256",
    "configSha256",
    "ignoreSha256"
  ]) {
    if (
      typeof authority[field] !== "string" ||
      !SHA256.test(authority[field])
    ) {
      errors.push(`formatter ${field} is invalid`);
    }
  }
  if (
    typeof authority.packageManager !== "string" ||
    !/^pnpm@\d+\.\d+\.\d+(?:\+sha512\.[a-f0-9]+)?$/u.test(
      authority.packageManager
    )
  ) {
    errors.push("formatter package manager is not an exact pnpm version");
  }
  if (
    typeof authority.prettierVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(authority.prettierVersion)
  ) {
    errors.push("formatter Prettier version is not exact");
  }
  return errors;
}

export function assertCurrentPullRequest({
  pullRequest,
  repository,
  number,
  headRepository,
  headRef,
  headSha
}) {
  if (!pullRequest || typeof pullRequest !== "object") {
    throw new Error("GitHub returned no source pull request");
  }
  if (pullRequest.state !== "open") {
    throw new Error("source pull request is closed; refusing stale autofix");
  }
  if (pullRequest.number !== number) {
    throw new Error(
      "source pull request number changed; refusing stale autofix"
    );
  }
  if (
    pullRequest.base?.repo?.full_name?.toLowerCase() !==
    repository.toLowerCase()
  ) {
    throw new Error(
      "source pull request base repository changed; refusing stale autofix"
    );
  }
  if (
    pullRequest.head?.repo?.full_name?.toLowerCase() !==
    headRepository.toLowerCase()
  ) {
    throw new Error(
      "source pull request head repository changed; refusing stale autofix"
    );
  }
  if (
    pullRequest.head?.repo?.full_name?.toLowerCase() !==
    repository.toLowerCase()
  ) {
    throw new Error(
      "external fork pull requests are explicitly excluded from autofix"
    );
  }
  if (pullRequest.head?.ref !== headRef) {
    throw new Error(
      "source pull request head ref changed; refusing stale autofix"
    );
  }
  if (pullRequest.head?.sha !== headSha) {
    throw new Error(
      "source pull request head SHA changed; refusing stale autofix"
    );
  }
}

export function validatePatch(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.byteLength === 0) throw new Error("patch is empty");
  if (bytes.byteLength > MAX_PATCH_BYTES)
    throw new Error("patch exceeds the size limit");

  let patch;
  try {
    patch = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("patch is not valid UTF-8 text");
  }
  if (patch.includes("\0")) throw new Error("patch contains binary data");
  if (!patch.endsWith("\n")) throw new Error("patch must end with a newline");
  if (/^(?:GIT binary patch|Binary files .* differ)$/mu.test(patch)) {
    throw new Error("binary patches are not permitted");
  }
  if (/^Subproject commit /mu.test(patch)) {
    throw new Error("submodule changes are not permitted");
  }

  const lines = patch.slice(0, -1).split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      current = { header: line, lines: [] };
      sections.push(current);
    } else if (current === null) {
      throw new Error("patch contains data before the first file header");
    } else {
      current.lines.push(line);
    }
  }
  if (sections.length === 0) throw new Error("patch contains no file changes");
  if (sections.length > MAX_PATCH_FILES)
    throw new Error("patch changes too many files");

  const seenPaths = new Set();
  let totalChangedLines = 0;
  for (const section of sections) {
    const [oldHeaderPath, newHeaderPath] = parsePathPair(
      section.header.slice("diff --git ".length)
    );
    const oldPath = requirePrefixedPath(oldHeaderPath, "a/");
    const newPath = requirePrefixedPath(newHeaderPath, "b/");
    assertSafePath(oldPath);
    assertSafePath(newPath);
    if (oldPath !== newPath)
      throw new Error("renames and cross-path changes are not permitted");
    if (seenPaths.has(oldPath))
      throw new Error("patch contains duplicate file sections");
    seenPaths.add(oldPath);

    let oldFilePath;
    let newFilePath;
    let sawHunk = false;
    let hunkChangedLines = 0;
    let previousHunkLine;
    for (let i = 0; i < section.lines.length; i += 1) {
      const line = section.lines[i];
      if (
        /^(?:old mode|new mode|new file mode|deleted file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|GIT binary patch|Binary files )/u.test(
          line
        )
      ) {
        throw new Error(
          "patch contains a mode change, rename, copy, or binary change"
        );
      }
      if (line.startsWith("index ")) {
        if (
          sawHunk ||
          !/^index [a-f0-9]{7,64}\.\.[a-f0-9]{7,64}(?: (?:100644|100755))?$/u.test(
            line
          )
        ) {
          throw new Error("patch contains a malformed or unsafe index header");
        }
        continue;
      }
      if (!sawHunk && line.startsWith("--- ")) {
        if (oldFilePath !== undefined)
          throw new Error("patch has duplicate old-file headers");
        oldFilePath = requirePrefixedPath(parseSinglePath(line.slice(4)), "a/");
        continue;
      }
      if (!sawHunk && line.startsWith("+++ ")) {
        if (newFilePath !== undefined)
          throw new Error("patch has duplicate new-file headers");
        newFilePath = requirePrefixedPath(parseSinglePath(line.slice(4)), "b/");
        continue;
      }
      if (line.startsWith("@@ ")) {
        if (oldFilePath === undefined || newFilePath === undefined) {
          throw new Error("patch hunk is missing file headers");
        }
        if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/u.test(line)) {
          throw new Error("patch contains a malformed hunk header");
        }
        sawHunk = true;
        previousHunkLine = undefined;
        continue;
      }
      if (!sawHunk) {
        throw new Error("patch contains an unsupported file header");
      }
      if (line.startsWith("\\ No newline at end of file")) {
        if (
          line !== "\\ No newline at end of file" ||
          previousHunkLine === undefined ||
          !previousHunkLine.startsWith("-") ||
          previousHunkLine.startsWith("---")
        ) {
          throw new Error("patch without final newlines is not permitted");
        }
        previousHunkLine = line;
        continue;
      }
      if (line.startsWith("+") || line.startsWith("-")) {
        totalChangedLines += 1;
        hunkChangedLines += 1;
      } else if (!line.startsWith(" ")) {
        throw new Error("patch contains malformed hunk data");
      }
      previousHunkLine = line;
    }
    if (
      oldFilePath === undefined ||
      newFilePath === undefined ||
      !sawHunk ||
      hunkChangedLines === 0
    ) {
      throw new Error("patch file section has no valid text changes");
    }
    if (oldFilePath !== oldPath || newFilePath !== newPath) {
      throw new Error("patch file headers do not match the diff paths");
    }
    if (oldFilePath === "/dev/null" || newFilePath === "/dev/null") {
      throw new Error("file additions and deletions are not permitted");
    }
  }
  if (totalChangedLines === 0)
    throw new Error("patch contains no formatting changes");
  return {
    files: [...seenPaths],
    changedLines: totalChangedLines,
    bytes: bytes.byteLength
  };
}

export async function upsertAutofixPullRequest({
  api,
  repository,
  sourcePullRequest,
  branch
}) {
  const [owner] = repository.split("/");
  const existing = await api.listOpenPullRequests({
    repository,
    head: `${owner}:${branch}`
  });
  if (existing.length > 1) {
    throw new Error(
      "multiple open autofix pull requests use the deterministic branch"
    );
  }
  if (existing.length === 1) {
    const pullRequest = existing[0];
    if (
      pullRequest.head?.repo?.full_name?.toLowerCase() !==
      repository.toLowerCase()
    ) {
      throw new Error(
        "existing autofix pull request head repository is not trusted"
      );
    }
    if (pullRequest.base?.ref !== sourcePullRequest.head.ref) {
      await api.updatePullRequest({
        repository,
        number: pullRequest.number,
        base: sourcePullRequest.head.ref
      });
    }
    return { action: "reused", number: pullRequest.number };
  }

  const created = await api.createPullRequest({
    repository,
    title: `style: format PR #${sourcePullRequest.number}`,
    body: [
      `Automated Prettier formatting repair for #${sourcePullRequest.number}.`,
      "",
      `This stacked pull request targets \`${sourcePullRequest.head.ref}\` and was generated from \`${sourcePullRequest.head.sha}\`.`,
      "",
      "Review the formatting changes before merging. This pull request is not auto-merged."
    ].join("\n"),
    head: branch,
    base: sourcePullRequest.head.ref
  });
  return { action: "created", number: created.number };
}

function parsePathPair(value) {
  let offset = 0;
  const first = parseGitPathToken(value, offset);
  offset = first.next;
  if (value[offset] !== " ") throw new Error("malformed diff path pair");
  const second = parseGitPathToken(value, offset + 1);
  if (second.next !== value.length) throw new Error("malformed diff path pair");
  return [first.path, second.path];
}

function parseSinglePath(value) {
  const parsed = parseGitPathToken(value, 0);
  if (parsed.next !== value.length)
    throw new Error("malformed file path header");
  return parsed.path;
}

function parseGitPathToken(value, offset) {
  if (value[offset] === '"') {
    let end = offset + 1;
    let escaped = false;
    for (; end < value.length; end += 1) {
      if (!escaped && value[end] === '"') break;
      if (!escaped && value[end] === "\\") escaped = true;
      else escaped = false;
    }
    if (end >= value.length) throw new Error("unterminated quoted diff path");
    return {
      path: decodeGitQuotedPath(value.slice(offset + 1, end)),
      next: end + 1
    };
  }
  let end = value.indexOf(" ", offset);
  if (end === -1) end = value.length;
  if (end === offset) throw new Error("empty diff path");
  return { path: value.slice(offset, end), next: end };
}

function decodeGitQuotedPath(value) {
  const bytes = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\\") {
      bytes.push(...Buffer.from(value[i], "utf8"));
      continue;
    }
    i += 1;
    const escaped = value[i];
    const simple = {
      '"': 0x22,
      "\\": 0x5c,
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d
    };
    if (Object.hasOwn(simple, escaped)) {
      bytes.push(simple[escaped]);
      continue;
    }
    const octal = value.slice(i).match(/^[0-7]{1,3}/u)?.[0];
    if (!octal) throw new Error("unsupported escape in quoted diff path");
    bytes.push(Number.parseInt(octal, 8));
    i += octal.length - 1;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes)
    );
  } catch {
    throw new Error("quoted diff path is not valid UTF-8");
  }
}

function requirePrefixedPath(path, prefix) {
  if (!path.startsWith(prefix))
    throw new Error(`patch path must use the ${prefix} prefix`);
  return path.slice(prefix.length);
}

function assertSafePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    path.split("/")[0] === ".git" ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error("patch path is unsafe or outside the source checkout");
  }
}
