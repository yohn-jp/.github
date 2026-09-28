#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const version = packageJson.dependencies?.["gh-inari"];

if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    'package.json must pin "gh-inari" to an exact published x.y.z version'
  );
}

process.stdout.write(`${version}\n`);
