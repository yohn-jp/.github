#!/usr/bin/env node
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { preparePatchHandoff } from "./lib.mjs";

const required = [
  "SOURCE_CHECKOUT",
  "FORMATTER_AUTHORITY_OUTPUT",
  "RUNNER_TEMP",
  "GITHUB_OUTPUT",
  "GITHUB_REPOSITORY",
  "SOURCE_PR_NUMBER",
  "SOURCE_HEAD_REPOSITORY",
  "SOURCE_HEAD_REF",
  "SOURCE_HEAD_SHA",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT"
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const authorityStat = lstatSync(process.env.FORMATTER_AUTHORITY_OUTPUT);
if (!authorityStat.isFile() || authorityStat.isSymbolicLink()) {
  throw new Error("trusted formatter authority metadata is not a regular file");
}
if (authorityStat.size > 16 * 1024) {
  throw new Error(
    "trusted formatter authority metadata exceeds the size limit"
  );
}
const formatterAuthority = JSON.parse(
  readFileSync(process.env.FORMATTER_AUTHORITY_OUTPUT, "utf8")
);
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: process.env.SOURCE_CHECKOUT,
  encoding: "utf8"
}).trim();
if (sourceSha !== process.env.SOURCE_HEAD_SHA) {
  throw new Error("source checkout does not match the observed PR head SHA");
}
const patch = execFileSync(
  "git",
  [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "HEAD",
    "--"
  ],
  {
    cwd: process.env.SOURCE_CHECKOUT,
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024
  }
);
const handoff = preparePatchHandoff({
  repository: process.env.GITHUB_REPOSITORY,
  pullRequest: Number(process.env.SOURCE_PR_NUMBER),
  headRepository: process.env.SOURCE_HEAD_REPOSITORY,
  headRef: process.env.SOURCE_HEAD_REF,
  headSha: process.env.SOURCE_HEAD_SHA,
  formatterAuthority,
  patch
});
if (!handoff.changed) {
  appendFileSync(process.env.GITHUB_OUTPUT, "changed=false\n");
  console.log(
    "No trusted Prettier changes; no autofix artifact or writer job is needed."
  );
  process.exit(0);
}

const directory = join(
  process.env.RUNNER_TEMP,
  `prettier-autofix-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
);
mkdirSync(directory, { recursive: false });
writeFileSync(join(directory, "patch.diff"), handoff.patch, { flag: "wx" });
writeFileSync(
  join(directory, "provenance.json"),
  `${JSON.stringify(handoff.provenance, null, 2)}\n`,
  { flag: "wx" }
);
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `changed=true\ndirectory=${directory}\n`
);
console.log(
  `Captured ${patch.byteLength} bytes of trusted Prettier patch and provenance.`
);
