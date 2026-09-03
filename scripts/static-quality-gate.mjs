#!/usr/bin/env node

// Deterministic, repository-agnostic static-quality gate.  The provider owns
// the report/baseline contract and a conservative built-in analyzer.  A
// consumer that already has Knip, ESLint, or another analyzer may provide a
// command that emits the same report format; the provider still owns
// normalization, exclusions, exceptions, and regression handling.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx"
]);
const REQUIRED_RULES = [
  "complexity",
  "function-size",
  "nesting-depth",
  "parameters"
];
const OPTIONAL_RULES = ["file-size"];
const RULE_ALIASES = {
  complexity: ["complexity"],
  "function-size": ["function-size", "max-lines-per-function"],
  "nesting-depth": ["nesting-depth", "max-depth"],
  parameters: ["parameters", "max-params"],
  "file-size": ["file-size", "max-lines"]
};
const DEFAULT_INCLUDE = ["src/**/*.{cjs,js,jsx,mjs,ts,tsx}"];
const DEFAULT_EXCLUDE = ["node_modules/**", ".git/**"];

/**
 * @typedef {{kind: string, rule: string, file: string, line: number,
 * column: number, message: string, symbol?: string, dependency?: string,
 * fingerprint: string}} Finding
 */

export class StaticQualityError extends Error {
  /** @param {string[] | string} errors */
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join("\n"));
    this.name = "StaticQualityError";
    this.errors = list;
  }
}

/**
 * Validate the consumer-owned static-quality configuration.  Thresholds are
 * deliberately required in the opt-in config so the provider never imposes
 * an arbitrary global migration threshold.
 *
 * @param {unknown} value
 * @param {string} sourceLabel
 * @returns {string[]}
 */
export function validateStaticQualityConfig(
  value,
  sourceLabel = "static-quality.yml"
) {
  const errors = [];
  const config = asRecord(value);
  if (config === null) {
    return [`${sourceLabel}: configuration must be a mapping`];
  }

  if (config["schema-version"] !== 1) {
    errors.push(`${sourceLabel}: schema-version must be 1`);
  }

  validateRelativeStringList(
    config["entry-points"],
    `${sourceLabel}: entry-points`,
    errors,
    { required: true }
  );
  validatePatternList(config.include, `${sourceLabel}: include`, errors, true);
  validatePatternList(config.exclude, `${sourceLabel}: exclude`, errors, false);

  const exceptions = asRecord(config.exceptions);
  if (exceptions === null) {
    errors.push(`${sourceLabel}: exceptions must be a mapping`);
  } else {
    for (const name of ["files", "exports", "dependencies"]) {
      validatePatternList(
        exceptions[name],
        `${sourceLabel}: exceptions.${name}`,
        errors,
        false
      );
    }
  }

  const maintainability = asRecord(config.maintainability);
  if (maintainability === null) {
    errors.push(`${sourceLabel}: maintainability must be a mapping`);
  } else {
    const rules = asRecord(maintainability.rules) ?? maintainability;
    for (const name of REQUIRED_RULES) {
      const valueForRule = readRuleValue(rules, name);
      if (!isPositiveInteger(valueForRule)) {
        errors.push(
          `${sourceLabel}: maintainability.${name} must be a positive integer`
        );
      }
    }
    if (
      hasAnyRule(rules, "file-size") &&
      !isPositiveInteger(readRuleValue(rules, "file-size"))
    ) {
      errors.push(
        `${sourceLabel}: maintainability.file-size must be a positive integer`
      );
    }
  }

  if (
    config["report-format"] !== undefined &&
    config["report-format"] !== "static-quality/v1"
  ) {
    errors.push(
      `${sourceLabel}: report-format must be static-quality/v1 when supplied`
    );
  }

  return errors;
}

/**
 * Run the provider's built-in analyzer or a consumer command and apply the
 * optional baseline.  Paths supplied here are relative to repositoryRoot;
 * analyzer paths inside the config are relative to root.
 *
 * @param {{root?: string, repositoryRoot?: string, configFile: string,
 * baselineFile?: string, checkCommand?: string}} options
 */
export function runStaticQualityGate(options) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const root = resolve(repositoryRoot, options.root ?? ".");
  const configFile = assertSafePath(options.configFile, "config-file");
  const configPath = resolve(repositoryRoot, configFile);
  const sourceLabel = configFile;

  if (!existsSync(configPath)) {
    throw new StaticQualityError(
      `${sourceLabel}: configuration file was not found`
    );
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new StaticQualityError(
      `working-directory does not exist or is not a directory: ${options.root ?? "."}`
    );
  }

  let config;
  try {
    config = yaml.load(readFileSync(configPath, "utf8"));
  } catch (cause) {
    throw new StaticQualityError(
      `${sourceLabel}: invalid YAML: ${cause.message}`
    );
  }
  const configErrors = validateStaticQualityConfig(config, sourceLabel);
  if (configErrors.length > 0) throw new StaticQualityError(configErrors);

  const baselineFile = options.baselineFile
    ? assertSafePath(options.baselineFile, "baseline-file")
    : "";
  const baseline = baselineFile
    ? loadBaseline(
        resolve(repositoryRoot, baselineFile),
        baselineFile,
        repositoryRoot
      )
    : [];

  let findings;
  if (options.checkCommand?.trim()) {
    findings = executeConsumerCheck({
      command: options.checkCommand,
      root,
      configPath,
      baselinePath: baselineFile ? resolve(repositoryRoot, baselineFile) : ""
    });
  } else {
    findings = analyzeStaticQuality({ root, config });
  }

  const filtered = sortFindings(applyConsumerFilters(findings, config));
  const baselineFingerprints = new Set(
    baseline.map((finding) => finding.fingerprint)
  );
  const newFindings = filtered.filter(
    (finding) => !baselineFingerprints.has(finding.fingerprint)
  );

  return {
    "schema-version": 1,
    findings: filtered,
    "new-findings": newFindings,
    baseline: {
      file: baselineFile || null,
      suppressed: filtered.length - newFindings.length
    }
  };
}

/**
 * Analyze the consumer source tree without repository-specific conditionals.
 * This is intentionally conservative: a consumer can delegate to its
 * Knip/ESLint setup through check-command when it needs language-specific
 * resolution or parser plugins.
 *
 * @param {{root: string, config: Record<string, unknown>}}
 * @returns {Finding[]}
 */
export function analyzeStaticQuality({ root, config }) {
  const include =
    stringList(config.include).length > 0
      ? stringList(config.include)
      : DEFAULT_INCLUDE;
  const exclude = [...DEFAULT_EXCLUDE, ...stringList(config.exclude)];
  const files = collectSourceFiles(root, include, exclude);
  const fileSet = new Set(files);
  const entryFiles = resolveEntryFiles(
    root,
    stringList(config["entry-points"]),
    files
  );
  const entrySet = new Set(entryFiles);
  const importsByFile = new Map();
  const usedDependencies = new Set();

  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    const imports = parseImports(source);
    const resolved = [];
    for (const item of imports) {
      if (item.specifier.startsWith(".")) {
        const target = resolveImport(file, item.specifier, fileSet);
        if (target !== null) resolved.push({ target, names: item.names });
      } else {
        usedDependencies.add(packageName(item.specifier));
      }
    }
    importsByFile.set(file, resolved);
  }

  const reachable = new Set(entryFiles);
  const pending = [...entryFiles];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const dependency of importsByFile.get(current) ?? []) {
      if (!reachable.has(dependency.target)) {
        reachable.add(dependency.target);
        pending.push(dependency.target);
      }
    }
  }

  const findings = [];
  for (const file of files) {
    if (!reachable.has(file)) {
      findings.push(
        makeFinding({
          kind: "unused-file",
          rule: "dead-code/file",
          file,
          message: "File is not reachable from any configured entry point"
        })
      );
    }
  }

  const importedNames = new Map();
  for (const [importer, dependencies] of importsByFile) {
    for (const dependency of dependencies) {
      const names = importedNames.get(dependency.target) ?? new Set();
      for (const name of dependency.names) names.add(name);
      importedNames.set(dependency.target, names);
    }
    // Keep the variable in the loop so the source-to-target relationship is
    // explicit in diagnostics/debuggers when this code is extended.
    void importer;
  }

  for (const file of reachable) {
    const source = readFileSync(join(root, file), "utf8");
    const exports = parseExports(source);
    if (entrySet.has(file)) continue; // configured entry points are public API
    const used = importedNames.get(file) ?? new Set();
    for (const exported of exports) {
      if (used.has("*") || used.has(exported.name)) continue;
      findings.push(
        makeFinding({
          kind: "unused-export",
          rule: "dead-code/export",
          file,
          line: exported.line,
          symbol: exported.name,
          message: `Export "${exported.name}" is not imported by another reachable file`
        })
      );
    }
  }

  findings.push(...findUnusedDependencies(root, usedDependencies));
  findings.push(...findMaintainabilityFindings(root, files, config));
  return findings;
}

/**
 * Parse the standard report emitted by consumer tooling.  ESLint JSON and
 * Knip's JSON shape are accepted as conveniences; a command that emits a
 * different format must convert it to static-quality/v1 in the consumer.
 *
 * @param {string} raw
 * @param {string} root
 * @returns {Finding[]}
 */
export function normalizeToolReport(raw, root = process.cwd()) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new StaticQualityError(
      `check-command output must be one JSON document: ${cause.message}`
    );
  }

  if (Array.isArray(value)) {
    if (
      value.every(
        (item) =>
          item && typeof item === "object" && Array.isArray(item.messages)
      )
    ) {
      return normalizeEslintReport(value, root);
    }
    throw new StaticQualityError(
      "check-command JSON array must use the ESLint report shape"
    );
  }
  if (asRecord(value) === null) {
    throw new StaticQualityError(
      "check-command output must be a JSON object or ESLint result array"
    );
  }

  if (value["schema-version"] === 1 || value.schemaVersion === 1) {
    if (!Array.isArray(value.findings)) {
      throw new StaticQualityError(
        "static-quality/v1 report must contain a findings array"
      );
    }
    return normalizeFindingList(value.findings, root, "check-command report");
  }

  // Knip's JSON reporter groups findings by category.  Mapping its stable
  // path/name fields lets consumers opt into Knip without a wrapper.
  const knipKeys = [
    "files",
    "dependencies",
    "unlisted",
    "exports",
    "types",
    "duplicates"
  ];
  if (knipKeys.some((key) => Array.isArray(value[key]))) {
    return normalizeKnipReport(value, root);
  }

  throw new StaticQualityError(
    "check-command output must use static-quality/v1, ESLint JSON, or Knip JSON"
  );
}

function normalizeEslintReport(results, root) {
  const findings = [];
  for (const result of results) {
    const file = toRelativeFile(result.filePath, root);
    for (const message of result.messages) {
      // ESLint warnings are informational; errors are blocking findings.
      if (Number(message.severity ?? 2) < 2) continue;
      findings.push(
        makeFinding({
          kind: "maintainability",
          rule: message.ruleId ? `eslint/${message.ruleId}` : "eslint/error",
          file,
          line: message.line ?? 1,
          column: message.column ?? 1,
          message: message.message ?? "ESLint reported a violation"
        })
      );
    }
  }
  return findings;
}

function normalizeLegacyKnipReport(value, root) {
  const findings = [];
  for (const file of value.files ?? []) {
    const path = typeof file === "string" ? file : file?.file;
    if (!path) continue;
    findings.push(
      makeFinding({
        kind: "unused-file",
        rule: "dead-code/file",
        file: toRelativeFile(path, root),
        message: `Knip reports unused file: ${toRelativeFile(path, root)}`
      })
    );
  }
  for (const dependency of value.dependencies ?? []) {
    const name = typeof dependency === "string" ? dependency : dependency?.name;
    if (!name) continue;
    findings.push(
      makeFinding({
        kind: "unused-dependency",
        rule: "dead-code/dependency",
        file: "package.json",
        dependency: name,
        message: `Knip reports unused dependency: ${name}`
      })
    );
  }
  for (const dependency of value.unlisted ?? []) {
    const name = typeof dependency === "string" ? dependency : dependency?.name;
    if (!name) continue;
    findings.push(
      makeFinding({
        kind: "unlisted-dependency",
        rule: "dead-code/unlisted-dependency",
        file:
          typeof dependency === "object" && dependency.file
            ? toRelativeFile(dependency.file, root)
            : "package.json",
        dependency: name,
        message: `Knip reports an unlisted dependency: ${name}`
      })
    );
  }
  for (const exported of value.exports ?? []) {
    const name = typeof exported === "string" ? exported : exported?.name;
    const file =
      typeof exported === "object" && exported.file
        ? toRelativeFile(exported.file, root)
        : "";
    if (!name || !file) continue;
    findings.push(
      makeFinding({
        kind: "unused-export",
        rule: "dead-code/export",
        file,
        symbol: name,
        message: `Knip reports unused export: ${name}`
      })
    );
  }
  for (const type of value.types ?? []) {
    const name = typeof type === "string" ? type : type?.name;
    const file =
      typeof type === "object" && type.file
        ? toRelativeFile(type.file, root)
        : "";
    if (!name || !file) continue;
    findings.push(
      makeFinding({
        kind: "unused-type",
        rule: "dead-code/type",
        file,
        symbol: name,
        message: `Knip reports unused type: ${name}`
      })
    );
  }
  for (const duplicate of value.duplicates ?? []) {
    const name = typeof duplicate === "string" ? duplicate : duplicate?.name;
    if (!name) continue;
    findings.push(
      makeFinding({
        kind: "duplicate-dependency",
        rule: "dead-code/duplicate",
        file: "package.json",
        dependency: name,
        message: `Knip reports duplicate dependency: ${name}`
      })
    );
  }
  return findings;
}

function normalizeKnipReport(value, root) {
  if (!Array.isArray(value.issues)) {
    return normalizeLegacyKnipReport(value, root);
  }

  const findings = [];
  for (const unusedFile of value.files ?? []) {
    const file = typeof unusedFile === "string" ? unusedFile : unusedFile?.file;
    if (!file) continue;
    const relativeFile = toRelativeFile(file, root);
    findings.push(
      makeFinding({
        kind: "unused-file",
        rule: "dead-code/file",
        file: relativeFile,
        message: "Knip reports unused file: " + relativeFile
      })
    );
  }
  for (const row of value.issues) {
    if (!row || typeof row.file !== "string") continue;
    const file = toRelativeFile(row.file, root);
    for (const category of [
      "dependencies",
      "devDependencies",
      "optionalPeerDependencies",
      "unlisted",
      "binaries",
      "unresolved"
    ]) {
      for (const issue of row[category] ?? []) {
        const item = asRecord(issue);
        const name = typeof issue === "string" ? issue : item?.name;
        if (!name) continue;
        const kind =
          category === "unlisted"
            ? "unlisted-dependency"
            : category === "binaries"
              ? "unused-binary"
              : category === "unresolved"
                ? "unresolved-dependency"
                : "unused-dependency";
        const rule =
          category === "unlisted"
            ? "dead-code/unlisted-dependency"
            : category === "binaries"
              ? "dead-code/binary"
              : category === "unresolved"
                ? "dead-code/unresolved"
                : "dead-code/dependency";
        findings.push(
          makeFinding({
            kind,
            rule,
            file,
            line: item?.line ?? 1,
            column: item?.col ?? 1,
            dependency: name,
            message: "Knip reports " + category + ": " + name
          })
        );
      }
    }
    for (const category of [
      "exports",
      "nsExports",
      "types",
      "nsTypes",
      "classMembers",
      "enumMembers"
    ]) {
      const issues = row[category] ?? [];
      const values = Array.isArray(issues)
        ? issues
        : Object.values(issues).flat();
      for (const issue of values) {
        const item = asRecord(issue);
        const name = typeof issue === "string" ? issue : item?.name;
        if (!name) continue;
        const isType = category.toLowerCase().includes("type");
        findings.push(
          makeFinding({
            kind: isType ? "unused-type" : "unused-export",
            rule: isType ? "dead-code/type" : "dead-code/export",
            file,
            line: item?.line ?? 1,
            column: item?.col ?? 1,
            symbol: name,
            message: "Knip reports " + category + ": " + name
          })
        );
      }
    }
    for (const duplicate of row.duplicates ?? []) {
      const name = Array.isArray(duplicate)
        ? duplicate.map((item) => item?.name ?? item).join(", ")
        : typeof duplicate === "string"
          ? duplicate
          : duplicate?.name;
      if (!name) continue;
      findings.push(
        makeFinding({
          kind: "duplicate-dependency",
          rule: "dead-code/duplicate",
          file,
          dependency: name,
          message: "Knip reports duplicate dependency: " + name
        })
      );
    }
  }
  return findings;
}

function normalizeFindingList(items, root, sourceLabel) {
  const findings = [];
  for (const [index, item] of items.entries()) {
    const finding = normalizeFinding(item, root, `${sourceLabel}[${index}]`);
    if (finding) findings.push(finding);
  }
  return findings;
}

function normalizeFinding(value, root, label) {
  const item = asRecord(value);
  if (item === null)
    throw new StaticQualityError(`${label}: finding must be a mapping`);
  const fileValue = item.file ?? item.filePath ?? item.path;
  const rule = item.rule;
  if (typeof fileValue !== "string" || fileValue.trim() === "") {
    throw new StaticQualityError(`${label}: file must be a non-empty string`);
  }
  if (typeof rule !== "string" || rule.trim() === "") {
    throw new StaticQualityError(`${label}: rule must be a non-empty string`);
  }
  return makeFinding({
    kind: typeof item.kind === "string" && item.kind ? item.kind : "violation",
    rule,
    file: toRelativeFile(fileValue, root),
    line: item.line ?? item.lineNumber ?? 1,
    column: item.column ?? 1,
    symbol: typeof item.symbol === "string" ? item.symbol : undefined,
    dependency:
      typeof item.dependency === "string" ? item.dependency : undefined,
    message:
      typeof item.message === "string" && item.message
        ? item.message
        : "Static-quality violation"
  });
}

function loadBaseline(path, sourceLabel, repositoryRoot) {
  if (!existsSync(path)) {
    throw new StaticQualityError(`${sourceLabel}: baseline file was not found`);
  }
  let value;
  try {
    value = yaml.load(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new StaticQualityError(
      `${sourceLabel}: invalid YAML/JSON: ${cause.message}`
    );
  }
  const record = asRecord(value);
  if (
    record === null ||
    record["schema-version"] !== 1 ||
    !Array.isArray(record.findings)
  ) {
    throw new StaticQualityError(
      `${sourceLabel}: baseline must contain schema-version: 1 and a findings array`
    );
  }
  return normalizeFindingList(record.findings, repositoryRoot, sourceLabel);
}

function executeConsumerCheck({ command, root, configPath, baselinePath }) {
  const result = spawnSync(command, {
    cwd: root,
    env: {
      ...process.env,
      STATIC_QUALITY_CONFIG: configPath,
      STATIC_QUALITY_BASELINE: baselinePath,
      STATIC_QUALITY_REPORT_FORMAT: "static-quality/v1"
    },
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) {
    throw new StaticQualityError(
      `check-command could not start: ${result.error.message}`
    );
  }
  let findings;
  try {
    findings = normalizeToolReport(result.stdout ?? "", root);
  } catch (cause) {
    const detail = result.stderr?.trim()
      ? ` stderr: ${result.stderr.trim()}`
      : "";
    throw new StaticQualityError(`${cause.message}${detail}`);
  }
  if (result.status !== 0 && findings.length === 0) {
    const detail = result.stderr?.trim() ? `: ${result.stderr.trim()}` : "";
    throw new StaticQualityError(
      `check-command exited with status ${result.status}${detail}`
    );
  }
  return findings;
}

function collectSourceFiles(root, include, exclude) {
  const files = [];
  walk(root, "");
  return files.sort();

  function walk(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        walk(join(directory, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name)))
        continue;
      if (
        !matchesAny(relativePath, include) ||
        matchesAny(relativePath, exclude)
      )
        continue;
      files.push(relativePath);
    }
  }
}

function resolveEntryFiles(root, entries, files) {
  const selected = new Set();
  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry);
    for (const file of files) {
      if (file === normalized || matchesPattern(file, normalized))
        selected.add(file);
    }
    if (
      selected.size === 0 ||
      ![...selected].some(
        (file) => file === normalized || matchesPattern(file, normalized)
      )
    ) {
      const candidate = resolveSourcePath(normalized, new Set(files));
      if (candidate !== null) selected.add(candidate);
    }
  }
  if (selected.size === 0) {
    throw new StaticQualityError(
      "entry-points must resolve to at least one included JavaScript/TypeScript file"
    );
  }
  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry);
    if (
      ![...selected].some(
        (file) => file === normalized || matchesPattern(file, normalized)
      )
    ) {
      throw new StaticQualityError(
        `entry-points entry does not resolve to an included file: ${entry}`
      );
    }
  }
  void root;
  return [...selected].sort();
}

function resolveImport(importer, specifier, fileSet) {
  const base = normalizeRelativePath(join(dirname(importer), specifier));
  return resolveSourcePath(base, fileSet);
}

function resolveSourcePath(base, fileSet) {
  const normalized = normalizeRelativePath(base);
  const candidates = [normalized];
  if (!extname(normalized)) {
    for (const extension of SOURCE_EXTENSIONS)
      candidates.push(`${normalized}${extension}`);
    for (const extension of SOURCE_EXTENSIONS)
      candidates.push(`${normalized}/index${extension}`);
  }
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function parseImports(source) {
  const imports = [];
  const fromPattern =
    /\b(?:import|export)\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(fromPattern)) {
    imports.push({ specifier: match[2], names: parseImportNames(match[1]) });
  }
  const sideEffectPattern = /\bimport\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(sideEffectPattern)) {
    imports.push({ specifier: match[1], names: ["*"] });
  }
  const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of source.matchAll(requirePattern)) {
    imports.push({ specifier: match[1], names: ["*"] });
  }
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of source.matchAll(dynamicPattern)) {
    imports.push({ specifier: match[1], names: ["*"] });
  }
  return imports;
}

function parseImportNames(clause) {
  const names = [];
  const trimmed = clause.trim().replace(/^type\s+/u, "");
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    for (const item of trimmed.slice(braceStart + 1, braceEnd).split(",")) {
      const name = item
        .trim()
        .replace(/^type\s+/u, "")
        .split(/\s+as\s+/u)[0];
      if (name) names.push(name);
    }
  }
  if (/\*/u.test(trimmed)) names.push("*");
  const beforeBrace = braceStart >= 0 ? trimmed.slice(0, braceStart) : trimmed;
  const defaultName = beforeBrace.split(",")[0].trim();
  if (
    defaultName &&
    !defaultName.startsWith("*") &&
    !defaultName.startsWith("{")
  )
    names.push("default");
  return names.length > 0 ? names : ["*"];
}

function parseExports(source) {
  const exports = [];
  const declared =
    /\bexport\s+(?:(?:declare|abstract)\s+)?(?:(?:async)\s+)?(?:const|let|var|function|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gu;
  for (const match of source.matchAll(declared)) {
    exports.push({ name: match[1], line: lineOf(source, match.index) });
  }
  const defaults = /\bexport\s+default\b/gu;
  for (const match of source.matchAll(defaults)) {
    exports.push({ name: "default", line: lineOf(source, match.index) });
  }
  const named = /\bexport\s*\{([^}]*)\}/gu;
  for (const match of source.matchAll(named)) {
    for (const item of match[1].split(",")) {
      const name = item
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) {
        exports.push({ name, line: lineOf(source, match.index) });
      }
    }
  }
  const unique = new Map();
  for (const item of exports) unique.set(item.name, item);
  return [...unique.values()];
}

function findUnusedDependencies(root, usedDependencies) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    return [];
  }
  const dependencies = new Set();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies"
  ]) {
    for (const name of Object.keys(asRecord(packageJson[field]) ?? {}))
      dependencies.add(name);
  }
  const raw = readFileSync(packagePath, "utf8");
  const findings = [];
  for (const name of [...dependencies].sort()) {
    if (usedDependencies.has(name)) continue;
    findings.push(
      makeFinding({
        kind: "unused-dependency",
        rule: "dead-code/dependency",
        file: "package.json",
        line: lineOf(raw, raw.indexOf(`"${name}"`)),
        dependency: name,
        message: `Dependency "${name}" is not imported by an included source file`
      })
    );
  }
  return findings;
}

function findMaintainabilityFindings(root, files, config) {
  const maintainability = asRecord(config.maintainability) ?? {};
  const rules = asRecord(maintainability.rules) ?? maintainability;
  const thresholds = Object.fromEntries(
    [...REQUIRED_RULES, ...OPTIONAL_RULES]
      .map((name) => [name, readRuleValue(rules, name)])
      .filter(([, value]) => value !== undefined)
  );
  const findings = [];
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    const lines = source.split("\n").length;
    if (
      thresholds["file-size"] !== undefined &&
      lines > thresholds["file-size"]
    ) {
      findings.push(
        makeFinding({
          kind: "maintainability",
          rule: "maintainability/max-lines",
          file,
          message: `File has ${lines} lines; maximum is ${thresholds["file-size"]}`
        })
      );
    }
    const masked = maskNonCode(source);
    for (const fn of findFunctions(masked)) {
      const body = masked.slice(fn.open + 1, fn.close);
      const complexity = 1 + countComplexity(body);
      const depth = maxBraceDepth(body);
      const functionLines =
        lineOf(source, fn.close) - lineOf(source, fn.start) + 1;
      const checks = [
        [
          "complexity",
          complexity,
          "maintainability/complexity",
          `Function "${fn.name}" has complexity ${complexity}; maximum is ${thresholds.complexity}`
        ],
        [
          "function-size",
          functionLines,
          "maintainability/max-lines-per-function",
          `Function "${fn.name}" has ${functionLines} lines; maximum is ${thresholds["function-size"]}`
        ],
        [
          "nesting-depth",
          depth,
          "maintainability/max-depth",
          `Function "${fn.name}" has nesting depth ${depth}; maximum is ${thresholds["nesting-depth"]}`
        ],
        [
          "parameters",
          fn.parameters,
          "maintainability/max-params",
          `Function "${fn.name}" has ${fn.parameters} parameters; maximum is ${thresholds.parameters}`
        ]
      ];
      for (const [name, actual, rule, message] of checks) {
        if (actual > thresholds[name]) {
          findings.push(
            makeFinding({
              kind: "maintainability",
              rule,
              file,
              line: lineOf(source, fn.start),
              message
            })
          );
        }
      }
    }
  }
  return findings;
}

function findFunctions(masked) {
  const functions = [];
  const patterns = [
    /\b(?:async\s+)?function(?:\s*\*)?\s*([A-Za-z_$][\w$]*|<anonymous>)?\s*\(([^)]*)\)\s*\{/gu,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/gu,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>\s*\{/gu
  ];
  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      const open = masked.indexOf("{", match.index);
      const close = matchingBrace(masked, open);
      if (open < 0 || close < 0) continue;
      functions.push({
        name: match[1] || "<anonymous>",
        start: match.index,
        open,
        close,
        parameters: countParameters(match[2])
      });
    }
  }
  return functions.sort((a, b) => a.start - b.start);
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function countParameters(value) {
  if (!value?.trim()) return 0;
  return splitTopLevel(value, ",").filter(Boolean).length;
}

function countComplexity(body) {
  const decisions =
    body.match(
      /\b(?:if|for|while|catch|case)\b|&&|\|\||\?\?(?![=])|\?(?!=)/gu
    ) ?? [];
  return decisions.length;
}

function maxBraceDepth(body) {
  let depth = 0;
  let max = 0;
  for (const character of body) {
    if (character === "{") {
      depth += 1;
      max = Math.max(max, depth);
    } else if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

function maskNonCode(source) {
  let output = "";
  let state = "code";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
        output += character;
      } else output += " ";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else output += character === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "string") {
      if (character === "\n") output += "\n";
      else output += " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) state = "code";
      continue;
    }
    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "'" || character === '"' || character === "`") {
      output += " ";
      quote = character;
      state = "string";
      escaped = false;
    } else {
      output += character;
    }
  }
  return output;
}

export function applyConsumerFilters(findings, config) {
  const exclude = [...DEFAULT_EXCLUDE, ...stringList(config.exclude)];
  const exceptions = asRecord(config.exceptions) ?? {};
  const exceptionFiles = stringList(exceptions.files);
  const exceptionExports = stringList(exceptions.exports);
  const exceptionDependencies = stringList(exceptions.dependencies);
  return findings.filter((finding) => {
    if (
      matchesAny(finding.file, exclude) ||
      matchesAny(finding.file, exceptionFiles)
    )
      return false;
    if (
      finding.kind === "unused-export" &&
      matchesAny(`${finding.file}:${finding.symbol ?? ""}`, exceptionExports)
    )
      return false;
    if (
      finding.dependency &&
      matchesAny(finding.dependency, exceptionDependencies)
    )
      return false;
    return true;
  });
}

function makeFinding({
  kind,
  rule,
  file,
  line = 1,
  column = 1,
  message,
  symbol,
  dependency
}) {
  const finding = {
    kind,
    rule,
    file: normalizeRelativePath(file),
    line: positiveNumber(line, 1),
    column: positiveNumber(column, 1),
    message
  };
  if (symbol) finding.symbol = symbol;
  if (dependency) finding.dependency = dependency;
  finding.fingerprint = fingerprint(finding);
  return finding;
}

function fingerprint(finding) {
  return [
    finding.kind,
    finding.rule,
    finding.file,
    finding.line,
    finding.column,
    finding.symbol ?? "",
    finding.dependency ?? ""
  ].join("|");
}

function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const leftKey = [
      left.file,
      left.line,
      left.column,
      left.rule,
      left.kind,
      left.symbol ?? "",
      left.dependency ?? "",
      left.message
    ].join("\0");
    const rightKey = [
      right.file,
      right.line,
      right.column,
      right.rule,
      right.kind,
      right.symbol ?? "",
      right.dependency ?? "",
      right.message
    ].join("\0");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function validateRelativeStringList(value, label, errors, { required }) {
  if (!Array.isArray(value) || value.length === 0) {
    if (required)
      errors.push(
        `${label} must be a non-empty list of repository-relative paths`
      );
    return;
  }
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.trim() === "" ||
      !isSafeRelativePath(item)
    ) {
      errors.push(
        `${label} entries must be non-empty repository-relative paths without '..'`
      );
    }
  }
}

function validatePatternList(value, label, errors, required) {
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || (required && value.length === 0)) {
    errors.push(
      `${label} must be a ${required ? "non-empty " : ""}list of repository-relative glob patterns`
    );
    return;
  }
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.trim() === "" ||
      !isSafeRelativePath(item)
    ) {
      errors.push(
        `${label} entries must be non-empty repository-relative glob patterns without '..'`
      );
    }
  }
}

function readRuleValue(rules, name) {
  for (const alias of RULE_ALIASES[name] ?? [name]) {
    if (rules[alias] !== undefined) return rules[alias];
  }
  return undefined;
}

function hasAnyRule(rules, name) {
  return (RULE_ALIASES[name] ?? [name]).some(
    (alias) => rules[alias] !== undefined
  );
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function packageName(specifier) {
  if (specifier.startsWith("@"))
    return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function toRelativeFile(value, root) {
  const absolute = resolve(root, value);
  const relativePath = relative(resolve(root), absolute);
  if (relativePath === ".." || relativePath.startsWith(".." + sep)) {
    throw new StaticQualityError(
      "finding file must stay inside the consumer working directory: " + value
    );
  }
  return normalizeRelativePath(relativePath || value);
}

function lineOf(source, offset) {
  if (!Number.isFinite(offset) || offset < 0) return 1;
  return source.slice(0, offset).split("\n").length;
}

function splitTopLevel(value, separator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if ("([{<".includes(character)) depth += 1;
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function normalizeRelativePath(value) {
  return String(value).replaceAll(sep, "/").replace(/^\.\//u, "");
}

function assertSafePath(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !isSafeRelativePath(value)
  ) {
    throw new StaticQualityError(
      `${label} must be a non-empty repository-relative path without '..'`
    );
  }
  return normalizeRelativePath(value);
}

function isSafeRelativePath(value) {
  return (
    !value.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]+/u).includes("..")
  );
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

function matchesPattern(value, pattern) {
  return expandBraces(normalizeRelativePath(pattern)).some((expanded) =>
    globToRegExp(expanded).test(normalizeRelativePath(value))
  );
}

function expandBraces(pattern) {
  const start = pattern.indexOf("{");
  if (start < 0) return [pattern];
  let depth = 0;
  let end = -1;
  for (let index = start; index < pattern.length; index += 1) {
    if (pattern[index] === "{") depth += 1;
    if (pattern[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) return [pattern];
  const alternatives = splitTopLevel(pattern.slice(start + 1, end), ",");
  return alternatives.flatMap((alternative) =>
    expandBraces(
      `${pattern.slice(0, start)}${alternative}${pattern.slice(end + 1)}`
    )
  );
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[|\\{}()[\]^$+.*]/gu, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
}

function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function stringList(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

function parseArgs(argv) {
  const result = {
    root: ".",
    config: "",
    baseline: "",
    checkCommand: "",
    output: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const names = {
      "--root": "root",
      "--config": "config",
      "--baseline": "baseline",
      "--check-command": "checkCommand",
      "--output": "output"
    };
    const name = names[argument];
    if (!name || index + 1 >= argv.length)
      throw new StaticQualityError(
        `unknown or incomplete argument: ${argument}`
      );
    result[name] = argv[index + 1];
    index += 1;
  }
  if (!result.config) throw new StaticQualityError("--config is required");
  return result;
}

function printReport(report) {
  const findings = report["new-findings"];
  console.log(
    `Static quality: ${report.findings.length} finding(s), ${findings.length} new, ${report.baseline.suppressed} baseline-suppressed.`
  );
  for (const finding of findings) {
    console.log(
      `${finding.file}:${finding.line}:${finding.column} ${finding.rule} — ${finding.message}`
    );
  }
  if (findings.length === 0) console.log("Static quality gate passed.");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const report = runStaticQualityGate({
      root: args.root,
      configFile: args.config,
      baselineFile: args.baseline,
      checkCommand: args.checkCommand
    });
    if (args.output)
      writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
    printReport(report);
    if (report["new-findings"].length > 0) process.exitCode = 1;
  } catch (cause) {
    const errors =
      cause instanceof StaticQualityError ? cause.errors : [cause.message];
    for (const error of errors)
      console.error(`::error title=Static quality configuration::${error}`);
    process.exitCode = 1;
  }
}

if (isMain()) main();
