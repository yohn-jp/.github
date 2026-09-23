#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();
const packageRoot =
  process.env.INARI_CANON_PACKAGE_ROOT ??
  path.join(repositoryRoot, "node_modules", "gh-inari");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function importExport(packageJson, subpath) {
  const target = packageJson.exports?.[subpath]?.import;
  if (typeof target !== "string") {
    throw new Error(`gh-inari does not export ${subpath}`);
  }
  return import(pathToFileURL(path.join(packageRoot, target)).href);
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function main() {
  const packageJson = await readJson(path.join(packageRoot, "package.json"));
  const semantic = await importExport(packageJson, "./semantic-template");
  const implementation = await importExport(
    packageJson,
    "./implementation-contract"
  );

  const errors = [];
  const identities = await semantic.discoverSemanticTemplates(repositoryRoot);

  for (const identity of identities) {
    const sourcePath = path.join(repositoryRoot, identity.sourcePath);
    const serialized = await readFile(sourcePath, "utf8");
    const authored = JSON.parse(serialized);
    const canonical = semantic.parseSemanticTemplate(
      serialized,
      identity.sourcePath
    );

    // parseSemanticTemplate is the current Inari normalization boundary. A
    // semantic source that only survives through legacy aliases/defaulting is
    // valid input, but it is not the current canonical representation.
    if (!isDeepStrictEqual(authored, canonical)) {
      errors.push(
        `${identity.sourcePath}: semantic JSON is accepted but is not the current canonical representation of gh-inari@${packageJson.version}`
      );
    }

    const document = { ...identity, source: canonical };
    const expected = semantic.renderSemanticNative(
      canonical,
      identity.generatedPath
    );
    const generatedPath = path.join(repositoryRoot, identity.generatedPath);
    let actual;
    try {
      actual = await readFile(generatedPath, "utf8");
    } catch {
      errors.push(
        `${identity.generatedPath}: generated native projection is missing`
      );
      continue;
    }
    if (actual !== expected) {
      errors.push(
        `${identity.generatedPath}: native projection drifts from gh-inari@${packageJson.version}`
      );
    }
  }

  const implementationIdentity = identities.find(
    (identity) =>
      identity.kind === "issue" &&
      identity.id === implementation.IMPLEMENTATION_TEMPLATE_ID
  );
  if (implementationIdentity === undefined) {
    errors.push(
      `missing semantic Implementation template id "${implementation.IMPLEMENTATION_TEMPLATE_ID}"`
    );
  } else {
    if (
      implementationIdentity.generatedPath !==
      implementation.IMPLEMENTATION_TEMPLATE_PATH
    ) {
      errors.push(
        `Implementation generated path is "${implementationIdentity.generatedPath}", expected "${implementation.IMPLEMENTATION_TEMPLATE_PATH}"`
      );
    }

    const document = await semantic.readSemanticTemplate(
      repositoryRoot,
      implementationIdentity
    );
    const actualIds = document.source.sections.map((section) => section.id);
    const expectedIds = Object.values(
      implementation.IMPLEMENTATION_TEMPLATE_FIELD_IDS
    );

    if (!sameArray(actualIds, expectedIds)) {
      errors.push(
        `Implementation field IDs drift from Inari Core: actual=${JSON.stringify(actualIds)} expected=${JSON.stringify(expectedIds)}`
      );
    }

    for (const section of document.source.sections) {
      const expectedLabel =
        implementation.IMPLEMENTATION_TEMPLATE_FIELD_LABELS[section.id];
      if (expectedLabel === undefined) {
        errors.push(
          `Implementation field "${section.id}" is not defined by Inari Core`
        );
      } else if (section.label !== expectedLabel) {
        errors.push(
          `Implementation field "${section.id}" label is "${section.label}", expected "${expectedLabel}"`
        );
      }
    }
  }

  const issueFiles = (
    await readdir(path.join(repositoryRoot, ".github", "inari", "issues"))
  )
    .filter((name) => name.endsWith(".json"))
    .sort();
  const prFiles = (
    await readdir(
      path.join(repositoryRoot, ".github", "inari", "pull-requests")
    )
  )
    .filter((name) => name.endsWith(".json"))
    .sort();

  console.log(
    `Inari Canon conformance: gh-inari@${packageJson.version}; ${issueFiles.length} Issue templates; ${prFiles.length} PR templates`
  );

  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("OK organization templates conform to current Inari Canon.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
