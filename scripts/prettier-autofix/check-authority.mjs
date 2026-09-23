#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectFormatterAuthority } from "./lib.mjs";

const directory = process.env.FORMATTER_AUTHORITY_DIRECTORY;
const output = process.env.GITHUB_OUTPUT;
if (!directory) throw new Error("FORMATTER_AUTHORITY_DIRECTORY is required");
if (!output) throw new Error("GITHUB_OUTPUT is required");

const result = inspectFormatterAuthority(resolve(directory));
appendFileSync(output, `available=${result.available ? "true" : "false"}\n`);

if (!result.available) {
  console.log(
    `::notice::Prettier autofix skipped because formatter authority is not configured; missing: ${result.missing.join(", ")}`
  );
}
