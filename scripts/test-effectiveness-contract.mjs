// Validation and mode-selection helpers for the reusable test-effectiveness
// workflow. The provider owns the contract shape and orchestration; consumers
// own commands, tools, generators, baselines, mutants, and exceptions.

export const TEST_EFFECTIVENESS_CAPABILITIES = Object.freeze([
  "coverage",
  "property",
  "mutation"
]);

const MUTATION_MODES = Object.freeze({
  pr: "pr-bounded",
  main: "main-full",
  nightly: "nightly-deep"
});

const EVENT_MODES = Object.freeze({
  pull_request: "pr",
  push: "main",
  schedule: "nightly",
  workflow_dispatch: "main"
});

/**
 * Select the consumer-visible mutation budget from the explicit caller mode.
 * An invalid value deliberately selects the broadest budget; the validator
 * rejects it before a command can run, so an unvalidated caller cannot get a
 * cheap PR budget by accident.
 *
 * @param {{executionMode?: string}} options
 * @returns {"pr-bounded"|"main-full"|"nightly-deep"}
 */
export function selectMutationMode({ executionMode = "pr" } = {}) {
  return MUTATION_MODES[executionMode] ?? "main-full";
}

/**
 * Select the exact consumer commit for a caller event. Pull-request merge
 * refs are deliberately excluded: the lane evaluates the PR head itself.
 *
 * @param {{eventName?: unknown, pullRequestHeadSha?: unknown, callerSha?: unknown}} context
 * @returns {string}
 */
export function selectConsumerSha({
  eventName,
  pullRequestHeadSha,
  callerSha
} = {}) {
  if (eventName === "pull_request") {
    const headSha = text(pullRequestHeadSha);
    if (!headSha) {
      throw new Error("pull_request head SHA is unavailable");
    }
    return headSha;
  }
  const sha = text(callerSha);
  if (!sha) {
    throw new Error("caller SHA is unavailable");
  }
  return sha;
}

/**
 * Return deterministic diagnostics for an execution mode/event pairing.
 * Reusable workflows inherit the caller's event, so this prevents a caller
 * from labelling a full run as a PR run (or vice versa).
 *
 * @param {{executionMode?: unknown, eventName?: unknown}} context
 * @returns {string[]}
 */
export function validateExecutionContext({ executionMode, eventName } = {}) {
  if (eventName === undefined || eventName === "") return [];
  if (typeof executionMode !== "string" || !(executionMode in MUTATION_MODES)) {
    return [];
  }
  const expected = EVENT_MODES[eventName];
  if (expected === undefined || expected !== executionMode) {
    return [
      `execution-mode '${executionMode}' must match caller event (pr=pull_request, main=push/workflow_dispatch, nightly=schedule); received '${String(eventName)}'`
    ];
  }
  return [];
}

/**
 * Return the stable lane status. Unknown, cancelled, and failed results all
 * fail closed; only successful jobs and intentionally skipped capabilities
 * pass.
 *
 * @param {unknown} results
 * @returns {"success"|"failure"}
 */
export function aggregateTestEffectivenessStatus(results) {
  if (!Array.isArray(results) || results.length === 0) return "failure";
  return results.every((result) => result === "success" || result === "skipped")
    ? "success"
    : "failure";
}

function isEnabled(value) {
  return value === true;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function relativePath(value, label, { required = false } = {}) {
  const path = text(value);
  if (!path) return required ? [`${label} is required`] : [];
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(path) ||
    path.split(/[\\/]/u).includes("..") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return [`${label} must be a safe path relative to working-directory`];
  }
  return [];
}

function command(value, label, { required = false } = {}) {
  const commandText = text(value);
  if (!commandText) return required ? [`${label} is required`] : [];
  if (commandText.includes("\0")) return [`${label} contains a NUL byte`];
  return [];
}

function boolean(value, label) {
  return typeof value === "boolean" ? [] : [`${label} must be boolean`];
}

function positiveInteger(value, label) {
  return Number.isInteger(value) && value > 0
    ? []
    : [`${label} must be a positive integer`];
}

/**
 * Validate consumer-supplied workflow inputs before any enabled command runs.
 * This checks only contract shape and safe paths, never repository-specific
 * test semantics or tool configuration.
 *
 * @param {Record<string, unknown>} config
 * @param {{eventName?: string}} context
 * @returns {string[]} deterministic diagnostics
 */
export function validateTestEffectivenessConfig(config = {}, context = {}) {
  const errors = [];
  const get = (name) => config[name];
  const executionMode = get("executionMode");

  if (typeof executionMode !== "string" || !(executionMode in MUTATION_MODES)) {
    errors.push("execution-mode must be one of pr, main, or nightly");
  }
  errors.push(
    ...validateExecutionContext({
      executionMode,
      eventName: context.eventName
    })
  );

  errors.push(
    ...relativePath(get("workingDirectory"), "working-directory", {
      required: true
    })
  );

  for (const name of [
    "coverageEnabled",
    "propertyEnabled",
    "mutationEnabled"
  ]) {
    errors.push(...boolean(get(name), name));
  }

  if (isEnabled(get("coverageEnabled"))) {
    errors.push(
      ...command(get("coverageCommand"), "coverage-command", {
        required: true
      })
    );
    errors.push(
      ...command(
        get("coverageRegressionCommand"),
        "coverage-regression-command",
        { required: true }
      )
    );
    errors.push(
      ...relativePath(get("coverageBaselinePath"), "coverage-baseline-path", {
        required: true
      })
    );
    errors.push(
      ...relativePath(get("coverageReportPath"), "coverage-report-path", {
        required: true
      })
    );
    errors.push(
      ...relativePath(get("coverageConfigPath"), "coverage-config-path")
    );
  }

  if (isEnabled(get("propertyEnabled"))) {
    errors.push(
      ...command(get("propertyCommand"), "property-command", {
        required: true
      })
    );
    errors.push(
      ...relativePath(get("propertyReportPath"), "property-report-path", {
        required: true
      })
    );
    if (typeof get("propertyRandomized") !== "boolean") {
      errors.push("property-randomized must be boolean");
    } else if (get("propertyRandomized")) {
      errors.push(
        ...command(get("propertySeed") || get("replaySeed"), "replay-seed", {
          required: true
        })
      );
      errors.push(
        ...command(get("propertyReplayCommand"), "property-replay-command", {
          required: true
        })
      );
    }
    errors.push(
      ...relativePath(get("propertyConfigPath"), "property-config-path")
    );
  }

  if (isEnabled(get("mutationEnabled"))) {
    errors.push(
      ...command(get("mutationCommand"), "mutation-command", {
        required: true
      })
    );
    errors.push(
      ...positiveInteger(
        get("mutationTimeoutSeconds"),
        "mutation-timeout-seconds"
      )
    );
    errors.push(
      ...relativePath(get("mutationReportPath"), "mutation-report-path", {
        required: true
      })
    );
    errors.push(
      ...relativePath(get("mutationConfigPath"), "mutation-config-path")
    );
  }

  return errors;
}

/**
 * Convert workflow input names into the object consumed by the validator.
 * Keeping this mapping in one place makes unit tests independent of GitHub's
 * expression evaluator.
 */
export function workflowInputsToConfig(inputs = {}) {
  return {
    workingDirectory: inputs["working-directory"],
    executionMode: inputs["execution-mode"],
    coverageEnabled: inputs["coverage-enabled"],
    coverageCommand: inputs["coverage-command"],
    coverageRegressionCommand: inputs["coverage-regression-command"],
    coverageBaselinePath: inputs["coverage-baseline-path"],
    coverageReportPath: inputs["coverage-report-path"],
    coverageConfigPath: inputs["coverage-config-path"],
    propertyEnabled: inputs["property-enabled"],
    propertyCommand: inputs["property-command"],
    propertyRandomized: inputs["property-randomized"],
    propertySeed: inputs["property-seed"],
    replaySeed: inputs["replay-seed"],
    propertyReplayCommand: inputs["property-replay-command"],
    propertyReportPath: inputs["property-report-path"],
    propertyConfigPath: inputs["property-config-path"],
    mutationEnabled: inputs["mutation-enabled"],
    mutationCommand: inputs["mutation-command"],
    mutationTimeoutSeconds: inputs["mutation-timeout-seconds"],
    mutationReportPath: inputs["mutation-report-path"],
    mutationConfigPath: inputs["mutation-config-path"]
  };
}

function parseBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseNumber(value) {
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function main() {
  if (process.argv[2] === "--select-consumer-sha") {
    try {
      const consumerSha = selectConsumerSha({
        eventName: process.env.EVENT_NAME,
        pullRequestHeadSha: process.env.PR_HEAD_SHA,
        callerSha: process.env.CALLER_SHA
      });
      console.log(`consumer_sha=${consumerSha}`);
    } catch (cause) {
      console.error(
        `::error title=Consumer checkout revision::${cause.message}`
      );
      process.exitCode = 1;
    }
    return;
  }

  const inputs = {
    "working-directory": process.env.WORKING_DIRECTORY,
    "execution-mode": process.env.EXECUTION_MODE,
    "coverage-enabled": parseBoolean(process.env.COVERAGE_ENABLED),
    "coverage-command": process.env.COVERAGE_COMMAND,
    "coverage-regression-command": process.env.COVERAGE_REGRESSION_COMMAND,
    "coverage-baseline-path": process.env.COVERAGE_BASELINE_PATH,
    "coverage-report-path": process.env.COVERAGE_REPORT_PATH,
    "coverage-config-path": process.env.COVERAGE_CONFIG_PATH,
    "property-enabled": parseBoolean(process.env.PROPERTY_ENABLED),
    "property-command": process.env.PROPERTY_COMMAND,
    "property-randomized": parseBoolean(process.env.PROPERTY_RANDOMIZED),
    "property-seed": process.env.PROPERTY_SEED,
    "replay-seed": process.env.REPLAY_SEED,
    "property-replay-command": process.env.PROPERTY_REPLAY_COMMAND,
    "property-report-path": process.env.PROPERTY_REPORT_PATH,
    "property-config-path": process.env.PROPERTY_CONFIG_PATH,
    "mutation-enabled": parseBoolean(process.env.MUTATION_ENABLED),
    "mutation-command": process.env.MUTATION_COMMAND,
    "mutation-timeout-seconds": parseNumber(
      process.env.MUTATION_TIMEOUT_SECONDS
    ),
    "mutation-report-path": process.env.MUTATION_REPORT_PATH,
    "mutation-config-path": process.env.MUTATION_CONFIG_PATH
  };
  const config = workflowInputsToConfig(inputs);
  const errors = validateTestEffectivenessConfig(config, {
    eventName: process.env.EVENT_NAME
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Test-effectiveness configuration valid (mutation mode: ${selectMutationMode(config)}).`
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
