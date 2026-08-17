import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateInariFormatFile } from "../scripts/validate-inari-format.mjs";

test("canonically formatted JSON passes validation", async () => {
  const errors = await validateInariFormatFile("test/fixtures/inari-format/well-formatted.json");
  assert.deepEqual(errors, []);
});

test("non-canonical formatting is rejected", async () => {
  const errors = await validateInariFormatFile("test/fixtures/inari-format/badly-formatted.json");
  assert.ok(errors.length > 0, "expected a formatting error");
  assert.ok(errors[0].includes("not formatted with the canonical Prettier configuration"));
});

test("formatting-only difference does not change parsed meaning", () => {
  const wellFormatted = JSON.parse(readFileSync("test/fixtures/inari-format/well-formatted.json", "utf8"));
  const badlyFormatted = JSON.parse(readFileSync("test/fixtures/inari-format/badly-formatted.json", "utf8"));
  assert.deepEqual(wellFormatted, badlyFormatted);
});

test("every canonical Inari JSON file passes formatting validation", async () => {
  const dirs = ["issues", "pull-requests"].map((d) => join(".github", "inari", d));
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(dir, name)),
  );
  assert.ok(files.length > 0, "expected at least one canonical Inari JSON file");

  for (const file of files) {
    const errors = await validateInariFormatFile(file);
    assert.deepEqual(errors, [], `${file}: ${JSON.stringify(errors)}`);
  }
});
