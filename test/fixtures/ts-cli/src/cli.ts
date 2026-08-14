#!/usr/bin/env node

import { version } from "./version";

function main(argv: string[]): void {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(version);
    return;
  }
  console.log(
    "ts-cli-fixture: a minimal fixture CLI used to self-test yohn-jp/.github's reusable TypeScript CLI CI workflow.",
  );
}

main(process.argv.slice(2));
