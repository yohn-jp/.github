#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractTemplateIdentityMarker,
  validateExistingPullRequestArtifact,
  validateRequiredMetadataString
} from "gh-inari/artifact";
import { compileLocalGovernedContract } from "gh-inari/governance";
import { classifyPullRequestBranch } from "./pr-contract-routing.mjs";
import { countTemplateIdentityMarkerAttempts } from "./pr-template-marker.mjs";
import { classifyEpicPrTitle } from "./epic-branch.mjs";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Validate a pull-request event against the checked-out repository's local
 * Inari snapshot. The workflow owns event plumbing; gh-inari owns contract
 * compilation, Markdown parsing, semantic validation, and (when route
 * evidence is supplied) Integration Routing projection.
 *
 * Template selection (Issue #211) is resolved directly from the PR body's
 * own gh-inari template-identity marker: `default`, `release`, `epic`, and
 * `authority` all go through the same marker mechanism, and there is no
 * branch/path/body-shape inference here. Branch-name governance
 * (classifyPullRequestBranch) still validates the head ref as its own
 * independent contract, but it no longer participates in template
 * selection. gh-inari itself only checks that a title is non-empty; the
 * canonical epic(<scope>): <description> title form (Issue #177) is a
 * separate, narrow addition owned directly here, exactly like branch-name
 * validation — see epic-branch.mjs. It only ever classifies a title that is
 * itself attempting the epic type; every ordinary/release title remains
 * unaffected.
 */
export async function validatePullRequest({
  title,
  body,
  root = REPOSITORY_ROOT,
  branch,
  routing: routingEvidence
}) {
  const routing = classifyPullRequestBranch({ branch });
  if (routing.errors.length > 0) {
    const violations = routing.errors.map((message) => ({
      code: "GOVERNANCE_RELEASE_BRANCH_INVALID",
      path: "$.pull_request.head.ref",
      message
    }));
    return {
      valid: false,
      branchClassification: routing.classification,
      violations,
      errors: violations.map((violation) => violation.message)
    };
  }

  if (routingEvidence !== undefined) {
    if (routingEvidence.invalid !== undefined) {
      const violation = routingEvidence.invalid;
      return {
        valid: false,
        branchClassification: routing.classification,
        violations: [violation],
        errors: [violation.message]
      };
    }
    const routeResult = await validateIntegrationRouting(routingEvidence);
    if (!routeResult.valid) {
      return {
        valid: false,
        branchClassification: routing.classification,
        routing: routeResult.projection,
        violations: routeResult.diagnostics,
        errors: routeResult.diagnostics.map((violation) => violation.message)
      };
    }
  }

  const resolution = await resolveTemplateContract(root, body);
  if (!resolution.valid) {
    return {
      valid: false,
      branchClassification: routing.classification,
      violations: resolution.violations,
      errors: resolution.violations.map((violation) => violation.message)
    };
  }

  const result = validateExistingPullRequestArtifact(
    resolution.contract,
    resolution.body
  );
  return report(
    { contract: resolution.contract, result },
    title,
    routing.classification
  );
}

/**
 * Validate explicit route evidence through the published Inari adapter. The
 * adapter is loaded at runtime so old consumers can preserve standalone and
 * release behavior during rollout; supplied route evidence always fails
 * closed when the canonical surface is unavailable.
 */
async function validateIntegrationRouting(input) {
  let inari;
  try {
    inari = await import("gh-inari");
  } catch (cause) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "GOVERNANCE_INARI_ROUTING_UNAVAILABLE",
          path: "$.routing",
          message: `Canonical Inari routing could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`
        }
      ]
    };
  }

  const projector = inari.tryProjectIntegrationRouting;
  if (typeof projector !== "function") {
    return {
      valid: false,
      diagnostics: [
        {
          code: "GOVERNANCE_INARI_ROUTING_UNAVAILABLE",
          path: "$.routing",
          message:
            "Canonical Inari routing is unavailable; route evidence cannot be validated."
        }
      ]
    };
  }

  try {
    const result = projector(input);
    return {
      valid: result?.valid === true,
      projection: result?.projection,
      diagnostics: Array.isArray(result?.diagnostics)
        ? result.diagnostics
        : [
            {
              code: "GOVERNANCE_INARI_ROUTING_INVALID",
              path: "$.routing",
              message:
                "Canonical Inari routing returned no structured diagnostics."
            }
          ]
    };
  } catch (cause) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "GOVERNANCE_INARI_ROUTING_INVALID",
          path: "$.routing",
          message: `Canonical Inari routing failed closed: ${cause instanceof Error ? cause.message : String(cause)}`
        }
      ]
    };
  }
}

/**
 * Parse exactly one valid `inari:template` marker from the PR body and
 * resolve the referenced template/semantic contract directly from its
 * declared identity/path. Every failure mode is deterministic: there is no
 * fallback to inference or candidate matching once a marker is expected.
 */
async function resolveTemplateContract(root, body) {
  if (countTemplateIdentityMarkerAttempts(body) > 1) {
    return {
      valid: false,
      violations: [
        {
          code: "GOVERNANCE_TEMPLATE_MARKER_AMBIGUOUS",
          path: "$.pull_request.body",
          message:
            "Pull-request body contains more than one inari:template marker."
        }
      ]
    };
  }

  const extracted = extractTemplateIdentityMarker(body ?? "");
  if (extracted.status === "absent") {
    return {
      valid: false,
      violations: [
        {
          code: "GOVERNANCE_TEMPLATE_MARKER_MISSING",
          path: "$.pull_request.body",
          message:
            "Pull-request body is missing the required inari:template marker."
        }
      ]
    };
  }
  if (
    extracted.status === "malformed" ||
    extracted.status === "unsupported-version"
  ) {
    return {
      valid: false,
      violations: [
        {
          code: "GOVERNANCE_TEMPLATE_MARKER_INVALID",
          path: "$.pull_request.body",
          message: "Pull-request body has a malformed inari:template marker."
        }
      ]
    };
  }

  const { marker } = extracted;
  if (marker.kind !== "pull_request") {
    return {
      valid: false,
      violations: [
        {
          code: "GOVERNANCE_TEMPLATE_MARKER_WRONG_KIND",
          path: "$.pull_request.body",
          message: `Pull-request body's inari:template marker declares kind "${marker.kind}", not "pull_request".`
        }
      ]
    };
  }

  try {
    const contract = await compileLocalGovernedContract(
      "pr",
      root,
      marker.path
    );
    return { valid: true, contract, body: extracted.body };
  } catch {
    return {
      valid: false,
      violations: [
        {
          code: "GOVERNANCE_TEMPLATE_UNAVAILABLE",
          path: "$.pull_request.body",
          message: `Pull-request body's inari:template marker references an unavailable template: "${marker.path}".`
        }
      ]
    };
  }
}

function report(outcome, title, branchClassification) {
  const violations = [...outcome.result.violations];
  const titleViolation = validateRequiredMetadataString(title, "title");
  if (titleViolation !== undefined) {
    violations.unshift(titleViolation);
  } else {
    // Only a title itself attempting the epic type is classified at all
    // (see epic-branch.mjs); every ordinary/release title is unaffected.
    const epicTitle = classifyEpicPrTitle(title);
    if (epicTitle?.kind === "invalid-epic-title") {
      violations.unshift({
        code: "GOVERNANCE_EPIC_PR_TITLE_INVALID",
        path: "$.pull_request.title",
        message: epicTitle.errors[0]
      });
    }
  }
  return {
    valid: violations.length === 0,
    contract: outcome.contract,
    branchClassification,
    result: outcome.result,
    violations,
    errors: violations.map((violation) => violation.message)
  };
}

function readRoutingEvidence(event) {
  const pullRequest = event.pull_request;
  const configured = process.env.INARI_ROUTING;
  let input;
  if (configured !== undefined && configured.trim() !== "") {
    try {
      const source = configured.trim();
      input = fs.existsSync(source)
        ? JSON.parse(fs.readFileSync(source, "utf8"))
        : JSON.parse(source);
    } catch (cause) {
      return {
        invalid: {
          code: "GOVERNANCE_INARI_ROUTING_INVALID",
          path: "$.routing",
          message: `Configured Inari routing evidence is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
        }
      };
    }
  } else {
    input =
      pullRequest?.routing ??
      pullRequest?.integration_routing ??
      pullRequest?.inari?.routing;
  }
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      invalid: {
        code: "GOVERNANCE_INARI_ROUTING_INVALID",
        path: "$.routing",
        message: "Inari routing evidence must be an object."
      }
    };
  }

  const observed = {
    ...(pullRequest?.head?.ref === undefined
      ? {}
      : { head: pullRequest.head.ref }),
    ...(pullRequest?.base?.ref === undefined
      ? {}
      : { base: pullRequest.base.ref })
  };
  if (Object.prototype.hasOwnProperty.call(input, "routing")) {
    return {
      ...input,
      routing:
        typeof input.routing === "object" &&
        input.routing !== null &&
        !Array.isArray(input.routing)
          ? { ...input.routing, ...observed }
          : input.routing
    };
  }
  return { ...input, ...observed };
}

async function main() {
  const eventPathArgIndex = process.argv.indexOf("--event");
  if (eventPathArgIndex === -1)
    throw new Error("--event <path-to-github-event-json> is required");
  const eventPath = process.argv[eventPathArgIndex + 1];
  if (eventPath === undefined) throw new Error("--event requires a path");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  if (!event.pull_request) throw new Error("event has no pull_request");

  const branchIndex = process.argv.indexOf("--branch");
  const pullRequest = event.pull_request;
  const branch =
    branchIndex === -1 ? pullRequest.head?.ref : process.argv[branchIndex + 1];
  const routingEvidence = readRoutingEvidence(event);
  const result = await validatePullRequest({
    title: pullRequest.title ?? "",
    body: pullRequest.body ?? "",
    root: process.cwd(),
    branch,
    routing: routingEvidence
  });
  console.log(
    JSON.stringify({
      valid: result.valid,
      ...(result.contract === undefined
        ? {}
        : { template: result.contract.templateIdentity }),
      ...(result.branchClassification === undefined
        ? {}
        : { branchClassification: result.branchClassification }),
      ...(result.result === undefined
        ? {}
        : { classification: result.result.classification }),
      ...(result.routing === undefined ? {} : { routing: result.routing }),
      violations: result.violations
    })
  );
  if (!result.valid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
