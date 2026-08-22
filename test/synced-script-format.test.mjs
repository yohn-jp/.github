import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import prettier from "prettier";
import yaml from "js-yaml";
import {
  SYNCED_SCRIPT_PATHS,
  loadSyncedScriptFormatConfig,
  validateSyncedScriptMappings,
  validateSyncedScriptFormats
} from "../scripts/validate-synced-script-format.mjs";

const sync = yaml.load(readFileSync(".github/sync.yml", "utf8"));
const authorityConfig = loadSyncedScriptFormatConfig();
const nawabariConfig = JSON.parse(
  readFileSync("test/fixtures/sync-format/nawabari-prettier.json", "utf8")
);

function mappingsFor(repository) {
  return new Map(
    (sync[repository] ?? []).map(({ source, dest }) => [dest, source])
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("canonical synchronized governance scripts are formatted and complete", async () => {
  assert.deepEqual(
    await validateSyncedScriptFormats(),
    [],
    "canonical synchronized scripts must satisfy the authority formatter profile"
  );
  assert.deepEqual(authorityConfig.files, SYNCED_SCRIPT_PATHS);
});

test("Nawabari is an explicit shared-format consumer with byte-copy mappings", () => {
  assert.deepEqual(
    validateSyncedScriptMappings({ sync, config: authorityConfig }),
    [],
    "the metadata workflow validator must enforce the sync/profile contract"
  );

  assert.deepEqual(
    Object.entries(sync)
      .filter(([, entries]) =>
        entries.some(({ source }) => SYNCED_SCRIPT_PATHS.includes(source))
      )
      .map(([repository]) => repository),
    ["yohn-jp/nawabari"]
  );

  const mappings = mappingsFor("yohn-jp/nawabari");
  for (const relativePath of SYNCED_SCRIPT_PATHS) {
    assert.equal(
      mappings.get(relativePath),
      relativePath,
      `yohn-jp/nawabari must receive ${relativePath} as a byte-copy projection`
    );
  }
});

test("sync/profile contract fails closed on drift", () => {
  const missingMapping = clone(sync);
  missingMapping["yohn-jp/nawabari"] = missingMapping[
    "yohn-jp/nawabari"
  ].filter(({ source }) => source !== SYNCED_SCRIPT_PATHS[0]);
  assert.match(
    validateSyncedScriptMappings({
      sync: missingMapping,
      config: authorityConfig
    }).join("\n"),
    /\[SYNC_FORMAT_MAPPING_MISSING\]/
  );

  const extraMapping = clone(sync);
  extraMapping["yohn-jp/nawabari"].push(
    clone(
      extraMapping["yohn-jp/nawabari"].find(
        ({ source }) => source === SYNCED_SCRIPT_PATHS[0]
      )
    )
  );
  assert.match(
    validateSyncedScriptMappings({
      sync: extraMapping,
      config: authorityConfig
    }).join("\n"),
    /\[SYNC_FORMAT_MAPPING_EXTRA\]/
  );

  const mismatchedMapping = clone(sync);
  const canonicalMapping = mismatchedMapping["yohn-jp/nawabari"].find(
    ({ source }) => source === SYNCED_SCRIPT_PATHS[0]
  );
  canonicalMapping.dest = "scripts/other.mjs";
  assert.match(
    validateSyncedScriptMappings({
      sync: mismatchedMapping,
      config: authorityConfig
    }).join("\n"),
    /\[SYNC_FORMAT_MAPPING_MISMATCH\]/
  );

  const undeclaredConsumer = clone(sync);
  undeclaredConsumer["example/consumer"] = clone(
    undeclaredConsumer["yohn-jp/nawabari"]
  );
  assert.match(
    validateSyncedScriptMappings({
      sync: undeclaredConsumer,
      config: authorityConfig
    }).join("\n"),
    /\[SYNC_FORMAT_CONSUMER_UNDECLARED\]/
  );

  const missingConsumer = clone(authorityConfig);
  delete missingConsumer.consumers["yohn-jp/nawabari"];
  assert.match(
    validateSyncedScriptMappings({
      sync,
      config: missingConsumer
    }).join("\n"),
    /\[SYNC_FORMAT_CONSUMER_UNDECLARED\]/
  );

  const mismatchedProfile = clone(authorityConfig);
  mismatchedProfile.profiles.nawabari.prettier.printWidth = 80;
  assert.match(
    validateSyncedScriptMappings({
      sync,
      config: mismatchedProfile
    }).join("\n"),
    /\[SYNC_FORMAT_PROFILE_MISMATCH\]/
  );
});

test("the canonical bytes satisfy Nawabari's pinned formatter profile", async () => {
  assert.deepEqual(
    nawabariConfig,
    authorityConfig.prettier,
    "a consumer with a different formatter profile must not be silently mapped"
  );

  for (const relativePath of SYNCED_SCRIPT_PATHS) {
    const raw = readFileSync(relativePath, "utf8");
    const formatted = await prettier.format(raw, {
      ...nawabariConfig,
      filepath: relativePath
    });
    assert.equal(
      formatted,
      raw,
      `${relativePath}: Nawabari format check would rewrite the sync artifact`
    );
  }
});
