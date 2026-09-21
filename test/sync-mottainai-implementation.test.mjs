import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));

function mappingsFor(repository) {
  return new Map(
    (sync[repository] ?? []).map(({ source, dest }) => [dest, source])
  );
}

test("Mottainai receives the canonical Implementation sources as byte-copy mappings", () => {
  const mappings = mappingsFor("yohn-jp/mottainai");

  for (const path of [
    ".github/ISSUE_TEMPLATE/implementation.yml",
    ".github/inari/issues/implementation.json"
  ]) {
    assert.equal(
      mappings.get(path),
      path,
      `yohn-jp/mottainai must receive ${path} from its canonical source`
    );
  }
});

test("Mottainai's product-specific governance workflow remains repository-owned", () => {
  const mappings = mappingsFor("yohn-jp/mottainai");

  assert.equal(
    mappings.get(".github/workflows/governance.yml"),
    undefined,
    "yohn-jp/mottainai governance.yml must not be replaced by the generic wrapper"
  );
  assert.equal(
    mappings.get(".github/workflows/release-governance.yml"),
    undefined,
    "yohn-jp/mottainai must not receive a separate release governance wrapper"
  );
});
