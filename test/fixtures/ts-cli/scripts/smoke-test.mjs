#!/usr/bin/env node
// Contract required by .github/workflows/npm-publish.yml's smoke-test job:
// `node scripts/smoke-test.mjs --tarball <path-to-tgz>`, using only Node
// built-ins (no devDependencies) since the smoke-test job intentionally
// doesn't install this package's own dependency tree — it simulates a real
// consumer installing the packed tarball fresh.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const tarball = getArg("--tarball");
  if (!tarball) {
    console.error("usage: smoke-test.mjs --tarball <path-to-tgz>");
    process.exit(1);
  }

  const smokeDir = mkdtempSync(path.join(tmpdir(), "smoke-test-"));
  writeFileSync(path.join(smokeDir, "package.json"), JSON.stringify({ private: true }));
  execFileSync("npm", ["install", "--no-save", "--prefix", smokeDir, path.resolve(tarball)], {
    stdio: "inherit",
  });

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const bin = pkg.bin;
  const binNames = !bin ? [] : typeof bin === "string" ? [pkg.name] : Object.keys(bin);

  if (binNames.length === 0) {
    console.log("No bin entries declared in package.json; skipping executable smoke test.");
    return;
  }

  for (const binName of binNames) {
    const binPath = path.join(smokeDir, "node_modules", ".bin", binName);
    try {
      execFileSync(binPath, ["--version"], { stdio: "inherit" });
    } catch {
      execFileSync(binPath, ["--help"], { stdio: "inherit" });
    }
  }

  console.log("smoke-test: OK");
}

main();
