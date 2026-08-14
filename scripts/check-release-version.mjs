#!/usr/bin/env node
// Verifies a GitHub Release tag matches the target package's package.json
// version, for the reusable npm publishing workflow
// (.github/workflows/npm-publish.yml). A mismatch must fail deterministically
// before any build/publish work happens.

/**
 * @param {string} packageVersion package.json "version"
 * @param {string} tagName release tag, e.g. "v1.2.3" or "1.2.3"
 * @returns {boolean} true if the tag (with an optional leading "v" stripped) equals packageVersion
 */
export function releaseTagMatchesPackageVersion(packageVersion, tagName) {
  const tagVersion = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  return packageVersion === tagVersion;
}

function isMain() {
  return process.argv[1]?.endsWith("check-release-version.mjs") ?? false;
}

function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const packageVersion = get("--package-version");
  const tag = get("--tag");
  if (!packageVersion || !tag) {
    console.error("usage: check-release-version.mjs --package-version <version> --tag <release-tag>");
    process.exitCode = 1;
    return;
  }

  if (releaseTagMatchesPackageVersion(packageVersion, tag)) {
    console.log(`release tag "${tag}" matches package.json version "${packageVersion}".`);
    return;
  }

  console.error(`package.json version "${packageVersion}" does not match release tag "${tag}".`);
  process.exitCode = 1;
}

if (isMain()) {
  main();
}
