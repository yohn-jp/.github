#!/usr/bin/env node
// Verifies a package.json "repository" matches the GitHub repository that
// publishes it, for the reusable npm publishing workflow
// (.github/workflows/npm-publish.yml). npm rejects a provenance publish with
// E422 when repository.url is empty or differs from the publishing
// repository, and only the registry notices; this surfaces it before publish.
import { readFileSync } from "node:fs";

/**
 * @param {unknown} repository package.json "repository" (string or { url })
 * @returns {string} canonical https://github.com/owner/repo URL, or the trimmed input when not a recognized GitHub form, or "" when unset
 */
export function normalizeRepositoryUrl(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (typeof raw !== "string") return "";
  let url = raw.trim();
  if (url === "") return "";
  const scp = url.match(/^git@github\.com:(.+)$/);
  const shorthand = url.match(/^github:(.+)$/);
  if (scp) url = "https://github.com/" + scp[1];
  else if (shorthand) url = "https://github.com/" + shorthand[1];
  url = url.replace(/^git\+/, "");
  url = url.replace(/\/+$/, "").replace(/\.git$/, "");
  return url;
}

/**
 * @param {unknown} repository package.json "repository"
 * @param {string} githubRepository "owner/repo" of the publishing repository
 * @returns {boolean}
 */
export function repositoryMatches(repository, githubRepository) {
  return (
    normalizeRepositoryUrl(repository) ===
    "https://github.com/" + githubRepository
  );
}

function isMain() {
  return process.argv[1]?.endsWith("check-repository-url.mjs") ?? false;
}

function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const packageJsonPath = get("--package-json");
  const githubRepository = get("--repository");
  if (!packageJsonPath || !githubRepository) {
    console.error(
      "usage: check-repository-url.mjs --package-json <path> --repository <owner/repo>"
    );
    process.exitCode = 1;
    return;
  }

  const repository = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
  ).repository;
  if (repositoryMatches(repository, githubRepository)) {
    console.log(
      `package.json repository.url matches https://github.com/${githubRepository}.`
    );
    return;
  }

  const actual = normalizeRepositoryUrl(repository);
  console.error(
    `package.json repository.url ${actual === "" ? "is not set" : `"${actual}" does not match`} (expected https://github.com/${githubRepository}). ` +
      "npm rejects the publish with E422 (provenance repository validation) for this."
  );
  process.exitCode = 1;
}

if (isMain()) {
  main();
}
