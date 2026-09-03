#!/usr/bin/env node
// Aggregate lane job results into the stable `quality` status the
// organization quality CI contract requires. Shared by
// .github/workflows/organization-quality.yml and its provider self-test so
// the pass/fail/skip semantics are verified independently of running the
// full aggregate workflow.
//
// The reusable-job result vocabulary is fixed by GitHub Actions:
// success, failure, cancelled, skipped, timed_out (composite/reusable jobs
// only), and action_required (deployment-protection jobs only). Any other
// value (empty, unset, a typo) is malformed input and must fail closed
// rather than pass silently.

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PASS_RESULTS = new Set(["success", "skipped"]);
const KNOWN_RESULTS = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required"
]);

/**
 * @param {Record<string, string>} laneResults lane name -> reusable-job result
 * @returns {{ status: "success" | "failure", reasons: string[] }}
 */
export function aggregateQualityStatus(laneResults) {
  const reasons = [];
  for (const [lane, result] of Object.entries(laneResults)) {
    if (!KNOWN_RESULTS.has(result)) {
      reasons.push(`${lane}: unrecognized result '${result}'`);
      continue;
    }
    if (!PASS_RESULTS.has(result)) {
      reasons.push(`${lane}: ${result}`);
    }
  }
  return {
    status: reasons.length === 0 ? "success" : "failure",
    reasons
  };
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function main() {
  const laneResults = {
    "static-quality": process.env.STATIC_QUALITY_RESULT ?? "",
    "supply-chain-security": process.env.SUPPLY_CHAIN_RESULT ?? "",
    "workflow-security": process.env.WORKFLOW_SECURITY_RESULT ?? "",
    "test-effectiveness": process.env.TEST_EFFECTIVENESS_RESULT ?? ""
  };
  const { status, reasons } = aggregateQualityStatus(laneResults);

  const summary = Object.entries(laneResults)
    .map(([lane, result]) => `${lane}=${result}`)
    .join(" ");
  console.log(`Lane results: ${summary} status=${status}.`);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `status=${status}\n`);
  }

  if (status === "failure") {
    console.error(
      `::error title=Organization quality aggregate failed::${reasons.join("; ")}. The aggregate fails closed.`
    );
    process.exitCode = 1;
  }
}

if (isMain()) {
  main();
}
