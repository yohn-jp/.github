import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const archiveName = "package.tgz";
const manifestName = "manifest.json";
const sourceShaPattern = /^[0-9a-f]{40}$/i;
const digestPattern = /^[0-9a-f]{64}$/;

function assertSourceSha(sourceSha) {
  if (!sourceShaPattern.test(sourceSha)) {
    throw new Error("source SHA must be a full 40-character commit SHA");
  }
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function inspectPackageArchive(archivePath) {
  const archiveStat = lstatSync(archivePath);
  if (!archiveStat.isFile() || archiveStat.size === 0) {
    throw new Error("package tarball must be a non-empty regular file");
  }

  const members = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8"
  })
    .split("\n")
    .filter(Boolean);

  if (
    members.some(
      (member) => member.startsWith("/") || member.split("/").includes("..")
    )
  ) {
    throw new Error("package tarball contains an unsafe path");
  }

  const forbidden = [
    ["node_modules/", (member) => /(^|\/)node_modules\//.test(member)],
    [".env", (member) => /(^|\/)\.env$/.test(member)],
    ["package/.git", (member) => /^package\/\.git(?:\/|$)/.test(member)],
    ["package/src/", (member) => /^package\/src\//.test(member)]
  ];
  for (const [label, matches] of forbidden) {
    if (members.some(matches)) {
      throw new Error(
        "package tarball unexpectedly contains files matching " + label
      );
    }
  }

  if (!members.some((member) => /^package\/dist\//.test(member))) {
    throw new Error("package tarball does not contain dist/");
  }

  return members;
}

export function createPackageArtifact({
  archivePath,
  artifactDirectory,
  sourceSha
}) {
  assertSourceSha(sourceSha);
  inspectPackageArchive(archivePath);

  const destination = resolve(artifactDirectory);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  copyFileSync(archivePath, resolve(destination, archiveName));

  const manifest = {
    sourceSha,
    archive: archiveName,
    sha256: sha256(resolve(destination, archiveName))
  };
  writeFileSync(
    resolve(destination, manifestName),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  return manifest;
}

export function verifyPackageArtifact({ artifactDirectory, expectedSha }) {
  assertSourceSha(expectedSha);
  const directory = resolve(artifactDirectory);
  const entries = readdirSync(directory).sort();
  if (
    entries.length !== 2 ||
    entries[0] !== manifestName ||
    entries[1] !== archiveName
  ) {
    throw new Error(
      "package artifact must contain only package.tgz and manifest.json"
    );
  }

  for (const entry of entries) {
    if (!lstatSync(resolve(directory, entry)).isFile()) {
      throw new Error("package artifact entries must be regular files");
    }
  }

  const manifest = JSON.parse(
    readFileSync(resolve(directory, manifestName), "utf8")
  );
  if (
    manifest.sourceSha !== expectedSha ||
    manifest.archive !== archiveName ||
    typeof manifest.sha256 !== "string" ||
    !digestPattern.test(manifest.sha256)
  ) {
    throw new Error("package artifact manifest does not match this revision");
  }

  const archivePath = resolve(directory, archiveName);
  if (sha256(archivePath) !== manifest.sha256) {
    throw new Error("package artifact bytes do not match their SHA-256");
  }
  inspectPackageArchive(archivePath);
  return { archivePath, ...manifest };
}

function readOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key.startsWith("--") || value === undefined || key in options) {
      throw new Error("expected unique --name value arguments");
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function runCli() {
  const [mode, ...args] = process.argv.slice(2);
  const options = readOptions(args);

  if (mode === "create") {
    const manifest = createPackageArtifact({
      archivePath: options.archive,
      artifactDirectory: options.directory,
      sourceSha: options["source-sha"]
    });
    process.stdout.write(JSON.stringify(manifest) + "\n");
    return;
  }
  if (mode === "verify") {
    const result = verifyPackageArtifact({
      artifactDirectory: options.directory,
      expectedSha: options["expected-sha"]
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  throw new Error("expected create or verify mode");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write((error?.stack ?? String(error)) + "\n");
    process.exitCode = 1;
  }
}
