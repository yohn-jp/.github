import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function expectedHeadings(contract) {
  return contract.sections
    .filter((section) => Number.isInteger(section.headingLevel))
    .map((section) => `${"#".repeat(section.headingLevel)} ${section.label}`);
}

function projectionErrors(contract, markdown) {
  return expectedHeadings(contract)
    .filter((heading) => !markdown.includes(`\n${heading}\n`))
    .map((heading) => `missing generated heading: ${heading}`);
}

test("PR projections contain headings derived from both synchronized contracts", () => {
  for (const name of ["default", "release"]) {
    const contract = JSON.parse(
      readFileSync(`.github/inari/pull-requests/${name}.json`, "utf8")
    );
    const markdown = readFileSync(
      `.github/PULL_REQUEST_TEMPLATE/${name}.md`,
      "utf8"
    );
    assert.deepEqual(projectionErrors(contract, markdown), [], name);
  }
});

test("a changed PR section cannot silently pass with a stale projection", () => {
  const contract = JSON.parse(
    readFileSync(".github/inari/pull-requests/default.json", "utf8")
  );
  const markdown = readFileSync(
    ".github/PULL_REQUEST_TEMPLATE/default.md",
    "utf8"
  );
  const changed = structuredClone(contract);
  changed.sections[0].label = "Delivered result";

  assert.ok(
    projectionErrors(changed, markdown).includes(
      "missing generated heading: ## Delivered result"
    )
  );
});
