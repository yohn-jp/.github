import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileLocalGovernedContract } from "gh-inari/governance";
import {
  loadCanonicalMarkdownArtifact,
  renderPullRequestArtifact,
  validateExistingPullRequestArtifact
} from "gh-inari/artifact";

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

test("default Validation is a canonical checklist shared by render and validate", async () => {
  const contract = await compileLocalGovernedContract(
    "pr",
    process.cwd(),
    "default"
  );
  const validation = contract.sections.find(
    (section) => section.id === "validation"
  )?.fields[0];

  assert.equal(validation?.type, "checklist");
  assert.deepEqual(
    validation?.items.map(({ id, label }) => ({ id, label })),
    [
      { id: "typecheck", label: "Typecheck" },
      { id: "tests", label: "Tests" },
      { id: "build", label: "Build" }
    ]
  );
  assert.deepEqual(
    contract.supplementalConstraints.fields.find(
      (field) => field.fieldId === "validation"
    ),
    { fieldId: "validation", checklistRequireComplete: true }
  );

  const fields = {
    summary: "Deliver one canonical PR presentation contract.",
    linked_issue: "Closes #125",
    changes:
      "Add the Inari validation checklist and synchronize its presentation policy.",
    validation: ["typecheck", "tests", "build"],
    review_focus:
      "Review the generated projection and consumer synchronization."
  };
  const rendered = renderPullRequestArtifact(contract, fields);
  const validated = validateExistingPullRequestArtifact(contract, rendered);
  const normalized = loadCanonicalMarkdownArtifact(contract, rendered);

  assert.equal(validated.valid, true);
  assert.equal(normalized.valid, true);
  assert.deepEqual(validated.parse.values, fields);
  assert.equal(
    renderPullRequestArtifact(contract, normalized.canonical),
    rendered
  );

  const withoutReviewFocus = { ...fields };
  delete withoutReviewFocus.review_focus;
  const renderedWithoutReviewFocus = renderPullRequestArtifact(
    contract,
    withoutReviewFocus
  );
  const validatedWithoutReviewFocus = validateExistingPullRequestArtifact(
    contract,
    renderedWithoutReviewFocus
  );
  assert.equal(validatedWithoutReviewFocus.valid, true);
  assert.deepEqual(validatedWithoutReviewFocus.parse.values, withoutReviewFocus);

  const incomplete = rendered.replace("- [x] Build", "- [ ] Build");
  const invalid = validateExistingPullRequestArtifact(contract, incomplete);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.violations.some(
      (violation) => violation.code === "INPUT_CHECKLIST_INCOMPLETE"
    )
  );
});
