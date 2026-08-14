#!/usr/bin/env node
// Formats gh-inari's structured JSON violations (stable `code`, optional
// `path`, `message`) into the Markdown comment body posted on a governed
// Issue. Kept separate from issue-governance.yml so the formatting logic
// is unit-testable rather than living only inside inline workflow YAML.

const FALLBACK_VIOLATION = {
  code: "GOVERNANCE_VALIDATION_FAILED",
  message: "The Issue governance validator did not produce structured diagnostics. Check the workflow run logs.",
};

/**
 * @param {ReadonlyArray<{code?: string, path?: string, message?: string}>} violations
 * @returns {string} Markdown comment body (trailing newline included)
 */
export function formatGovernanceViolations(violations) {
  const list = violations && violations.length > 0 ? violations : [FALLBACK_VIOLATION];
  const lines = ["Issue governance contract violation:", ""];
  for (const violation of list) {
    const code = violation.code ?? "GOVERNANCE_VALIDATION_FAILED";
    const path = violation.path ? `${violation.path}: ` : "";
    const message = violation.message ?? JSON.stringify(violation);
    lines.push(`- [${code}] ${path}${message}`);
  }
  return `${lines.join("\n")}\n`;
}

function isMain() {
  return process.argv[1]?.endsWith("format-governance-violations.mjs") ?? false;
}

function main() {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    let violations = [];
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      violations = Array.isArray(payload?.violations) ? payload.violations : [];
    } catch {
      violations = [];
    }
    process.stdout.write(formatGovernanceViolations(violations));
  });
}

if (isMain()) {
  main();
}
