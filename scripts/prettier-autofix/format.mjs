#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";

const required = [
  "FORMATTER_AUTHORITY_DIRECTORY",
  "FORMATTER_AUTHORITY_REF",
  "FORMATTER_AUTHORITY_OUTPUT",
  "PROVIDER_REPOSITORY",
  "PROVIDER_WORKFLOW_SHA",
  "SOURCE_CHECKOUT",
  "SOURCE_HEAD_SHA",
  "GITHUB_REPOSITORY"
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const authorityDirectory = realpathSync(
  resolve(process.env.FORMATTER_AUTHORITY_DIRECTORY)
);
const sourceDirectory = realpathSync(resolve(process.env.SOURCE_CHECKOUT));
if (
  authorityDirectory === sourceDirectory ||
  authorityDirectory.startsWith(`${sourceDirectory}${sep}`) ||
  sourceDirectory.startsWith(`${authorityDirectory}${sep}`)
) {
  throw new Error("formatter authority and PR source must be separate trees");
}

const sourceSha = git(sourceDirectory, ["rev-parse", "HEAD"]).trim();
if (sourceSha !== process.env.SOURCE_HEAD_SHA) {
  throw new Error(
    "formatter source checkout does not match the observed PR SHA"
  );
}
const authoritySha = git(authorityDirectory, ["rev-parse", "HEAD"]).trim();
if (!/^[a-f0-9]{40}$/u.test(authoritySha)) {
  throw new Error("formatter authority checkout has an invalid commit SHA");
}
if (!/^[a-f0-9]{40}$/u.test(process.env.PROVIDER_WORKFLOW_SHA)) {
  throw new Error("trusted provider workflow SHA is invalid");
}

const packagePath = trustedFile(authorityDirectory, "package.json");
const lockPath = trustedFile(authorityDirectory, "pnpm-lock.yaml");
const configPath = trustedFile(authorityDirectory, "prettier.config.mjs");
const ignorePath = trustedFile(authorityDirectory, ".prettierignore");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const expectedVersion =
  packageJson.devDependencies?.prettier ?? packageJson.dependencies?.prettier;
if (
  typeof expectedVersion !== "string" ||
  !/^\d+\.\d+\.\d+$/u.test(expectedVersion)
) {
  throw new Error("trusted package.json must pin an exact Prettier version");
}
if (
  typeof packageJson.packageManager !== "string" ||
  !/^pnpm@/u.test(packageJson.packageManager)
) {
  throw new Error("trusted package.json must declare its pnpm version");
}

const prettierPackagePath = trustedFile(
  authorityDirectory,
  "node_modules/prettier/package.json"
);
const prettierPackageRoot = dirname(realpathSync(prettierPackagePath));
const prettierPackage = JSON.parse(readFileSync(prettierPackagePath, "utf8"));
if (prettierPackage.version !== expectedVersion) {
  throw new Error(
    `trusted Prettier install ${prettierPackage.version} does not match package.json ${expectedVersion}`
  );
}
const prettierCli = trustedFile(
  authorityDirectory,
  "node_modules/prettier/bin/prettier.cjs"
);
const resolvedCli = realpathSync(prettierCli);
if (!resolvedCli.startsWith(`${prettierPackageRoot}${sep}`)) {
  throw new Error("Prettier CLI resolves outside the validated Prettier package");
}

const formatterAuthority = {
  providerRepository: process.env.PROVIDER_REPOSITORY,
  providerWorkflowSha: process.env.PROVIDER_WORKFLOW_SHA,
  consumerRepository: process.env.GITHUB_REPOSITORY,
  defaultBranch: process.env.FORMATTER_AUTHORITY_REF,
  defaultSha: authoritySha,
  packageJsonSha256: sha256(readFileSync(packagePath)),
  lockfileSha256: sha256(readFileSync(lockPath)),
  configSha256: sha256(readFileSync(configPath)),
  ignoreSha256: sha256(readFileSync(ignorePath)),
  packageManager: packageJson.packageManager,
  prettierVersion: prettierPackage.version
};

const sourcePath = relative(
  process.env.GITHUB_WORKSPACE ?? dirname(sourceDirectory),
  sourceDirectory
);
if (sourcePath.startsWith(`..${sep}`) || sourcePath === "..") {
  throw new Error("PR source checkout is outside the GitHub workspace");
}
const args = [
  "--write",
  "--config",
  configPath,
  "--ignore-path",
  ignorePath,
  "--no-editorconfig",
  sourceDirectory
];
console.log(
  `Running trusted Prettier ${prettierPackage.version} from ${formatterAuthority.consumerRepository}@${authoritySha} against source ${sourceSha}.`
);
execFileSync(process.execPath, [prettierCli, ...args], {
  cwd: authorityDirectory,
  stdio: "inherit",
  maxBuffer: 8 * 1024 * 1024
});

const output = resolve(process.env.FORMATTER_AUTHORITY_OUTPUT);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(formatterAuthority, null, 2)}\n`, {
  flag: "wx"
});

function trustedFile(root, relativePath) {
  const path = join(root, relativePath);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `trusted formatter input is not a regular file: ${relativePath}`
    );
  }
  return path;
}

function git(directory, args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
