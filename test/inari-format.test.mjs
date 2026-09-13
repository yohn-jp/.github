import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateInariFormatFile,
  isRuntimeAuthorityArtifact
} from "../scripts/validate-inari-format.mjs";

test("canonically formatted JSON passes validation", async () => {
  const errors = await validateInariFormatFile(
    "test/fixtures/inari-format/well-formatted.json"
  );
  assert.deepEqual(errors, []);
});

test("non-canonical formatting is rejected", async () => {
  const errors = await validateInariFormatFile(
    "test/fixtures/inari-format/badly-formatted.json"
  );
  assert.ok(errors.length > 0, "expected a formatting error");
  assert.ok(
    errors[0].includes(
      "not formatted with the canonical Prettier configuration"
    )
  );
});

test("formatting-only difference does not change parsed meaning", () => {
  const wellFormatted = JSON.parse(
    readFileSync("test/fixtures/inari-format/well-formatted.json", "utf8")
  );
  const badlyFormatted = JSON.parse(
    readFileSync("test/fixtures/inari-format/badly-formatted.json", "utf8")
  );
  assert.deepEqual(wellFormatted, badlyFormatted);
});

test("every canonical Inari JSON file passes formatting validation", async () => {
  const dirs = ["issues", "pull-requests"].map((d) =>
    join(".github", "inari", d)
  );
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(dir, name))
  );
  assert.ok(
    files.length > 0,
    "expected at least one canonical Inari JSON file"
  );

  for (const file of files) {
    const errors = await validateInariFormatFile(file);
    assert.deepEqual(errors, [], `${file}: ${JSON.stringify(errors)}`);
  }
});

test("a direct child of .github/inari/authorities/ is classified as a Runtime Authority artifact", () => {
  assert.ok(
    isRuntimeAuthorityArtifact(
      join(process.cwd(), ".github", "inari", "authorities", "example.json")
    )
  );
});

test("ordinary Inari JSON (issues/pull-requests) is not classified as a Runtime Authority artifact", () => {
  assert.ok(
    !isRuntimeAuthorityArtifact(
      join(process.cwd(), ".github", "inari", "issues", "example.json")
    )
  );
  assert.ok(
    !isRuntimeAuthorityArtifact(
      join(process.cwd(), ".github", "inari", "pull-requests", "example.json")
    )
  );
});

test("a nested subdirectory under authorities/ is not classified as a Runtime Authority artifact", () => {
  assert.ok(
    !isRuntimeAuthorityArtifact(
      join(
        process.cwd(),
        ".github",
        "inari",
        "authorities",
        "nested",
        "example.json"
      )
    ),
    "the exemption must not silently broaden beyond direct children of authorities/"
  );
});

test("a minified, no-trailing-newline canonical Runtime Authority artifact fails generic Prettier rules by itself; exclusion happens in the caller's scan, not in validateInariFormatFile", async () => {
  const path =
    "test/fixtures/inari-format/authorities/canonical-authority.json";

  const errors = await validateInariFormatFile(path);
  assert.ok(
    errors.length > 0,
    "validateInariFormatFile is format-only and does not classify paths; main() excludes authorities/*.json from the scan before this function ever sees them"
  );
});
