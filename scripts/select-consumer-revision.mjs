#!/usr/bin/env node
// Select the consumer checkout revision a quality lane must audit/test.
// pull_request runs must evaluate the PR head, never the ephemeral merge ref
// actions/checkout defaults to; other events (push, schedule) evaluate the
// caller's own commit. Either SHA being unavailable is a hard, fail-closed
// error rather than an implicit fallback.
//
// This mirrors the inline selection already used by
// .github/workflows/static-quality.yml and
// .github/workflows/test-effectiveness.yml; workflow-security.yml calls
// this script directly so the semantics have one source of truth and one
// test surface.

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {{ eventName: string, prHeadSha: string, callerSha: string }} input
 * @returns {{ sha: string } | { error: string }}
 */
export function selectConsumerRevision({ eventName, prHeadSha, callerSha }) {
  if (eventName === "pull_request") {
    if (!prHeadSha) {
      return { error: "pull_request head SHA is unavailable" };
    }
    return { sha: prHeadSha };
  }
  if (!callerSha) {
    return { error: "caller SHA is unavailable" };
  }
  return { sha: callerSha };
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  const eventName = process.env.EVENT_NAME ?? "";
  const result = selectConsumerRevision({
    eventName,
    prHeadSha: process.env.PR_HEAD_SHA ?? "",
    callerSha: process.env.CALLER_SHA ?? ""
  });

  if ("error" in result) {
    console.error(`::error title=Consumer revision selection::${result.error}`);
    process.exitCode = 1;
    return;
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `consumer_sha=${result.sha}\n`);
  }
  console.log(`Consumer checkout revision selected for event: ${eventName}`);
}

if (isMain()) {
  main();
}
