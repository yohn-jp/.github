#!/usr/bin/env node
// Fixture "conformance validation" step: demonstrates the
// typescript-cli-ci.yml `conformance-script` capability by checking the
// built CLI's --version output matches package.json, independent of the
// unit tests. Run via `pnpm run conformance:contract`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

const output = execFileSync("node", ["dist/cli.js", "--version"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
}).trim();

if (output !== pkg.version) {
  console.error(
    `conformance: \`ts-cli-fixture --version\` printed "${output}", expected "${pkg.version}" (package.json version)`,
  );
  process.exit(1);
}

console.log(`conformance: OK (--version reports ${output})`);
