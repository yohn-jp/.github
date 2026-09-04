import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

const actionPath = ".github/actions/setup-node-pnpm/action.yml";
const action = yaml.load(readFileSync(actionPath, "utf8"));
const steps = action.runs.steps;

function stepById(id) {
  const step = steps.find((s) => s.id === id);
  assert.ok(step, `expected a step with id "${id}"`);
  return step;
}

function stepByName(name) {
  const step = steps.find((s) => s.name === name);
  assert.ok(step, `expected a step named "${name}"`);
  return step;
}

/**
 * Runs a composite-action step's `run:` shell script directly, simulating
 * the GitHub Actions runner by supplying GITHUB_OUTPUT/env ourselves instead
 * of resolving `${{ }}` expressions. Returns parsed $GITHUB_OUTPUT entries
 * plus the raw process result.
 */
function runStep(step, { cwd, env = {}, path: extraPath } = {}) {
  const outputDir = mkdtempSync(
    path.join(os.tmpdir(), "setup-node-pnpm-output-")
  );
  const githubOutput = path.join(outputDir, "github-output");
  writeFileSync(githubOutput, "");

  let result;
  try {
    const stdout = execFileSync("bash", ["-c", step.run], {
      cwd,
      env: {
        ...process.env,
        ...(extraPath ? { PATH: `${extraPath}:${process.env.PATH}` } : {}),
        GITHUB_OUTPUT: githubOutput,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    result = { status: 0, stdout: stdout.toString(), stderr: "" };
  } catch (error) {
    result = {
      status: error.status ?? 1,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? ""
    };
  }

  const outputs = {};
  for (const line of readFileSync(githubOutput, "utf8").split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key) outputs[key] = rest.join("=");
  }
  rmSync(outputDir, { recursive: true, force: true });
  return { ...result, outputs };
}

function withFixtureDir(fn) {
  const dir = mktempFixture();
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mktempFixture() {
  return mkdtempSync(path.join(os.tmpdir(), "setup-node-pnpm-fixture-"));
}

// --- Static contract: no self-installer path, cache separation, no hardcoded
// repository identity, bounded retry confined to acquisition only. ---

test("does not depend on the pnpm/action-setup self-installer", () => {
  const usesRefs = steps.map((s) => s.uses).filter(Boolean);
  assert.ok(
    usesRefs.every((ref) => !ref.startsWith("pnpm/action-setup")),
    "expected no pnpm/action-setup step; the exact-version executable is provisioned directly"
  );
});

test("pnpm executable cache and pnpm store cache use distinct, repository-neutral keys", () => {
  const restoreExe = stepById("restore-exe");
  const saveExe = steps.find((s) => s.name === "Save pnpm executable cache");
  const restoreStore = stepById("restore-store");
  const saveStore = steps.find((s) => s.name === "Save pnpm store cache");

  const exeKey = restoreExe.with.key;
  const storeKey = restoreStore.with.key;

  assert.notEqual(exeKey, storeKey);
  assert.equal(saveExe.with.key, exeKey);
  assert.equal(saveStore.with.key, storeKey);
  assert.notEqual(restoreExe.with.path, restoreStore.with.path);

  for (const key of [exeKey, storeKey]) {
    assert.match(
      key,
      /\$\{\{\s*runner\.os\s*\}\}/,
      `${key} must vary by runner OS`
    );
    assert.doesNotMatch(
      key,
      /mottainai/i,
      `${key} must not carry a consumer repository identity`
    );
    assert.doesNotMatch(
      key,
      /github\.repository/,
      `${key} must not derive from the calling repository's identity`
    );
  }
  assert.match(exeKey, /pnpm-exe-/);
  assert.match(
    exeKey,
    /runner\.arch/,
    "executable cache must be keyed by architecture too"
  );
  assert.match(
    exeKey,
    /pnpm-version\.outputs\.version/,
    "executable cache must be keyed by the exact pnpm version"
  );
  assert.match(storeKey, /pnpm-store-/);
  assert.match(
    storeKey,
    /hashFiles/,
    "store cache must be keyed by lockfile content"
  );
});

test("bounded retry appears only around upstream acquisition, never around install/test commands", () => {
  const acquire = stepById("acquire-exe");
  const install = stepByName("Install dependencies");

  assert.match(acquire.run, /max_attempts/);
  assert.match(acquire.run, /until npm install/);
  assert.doesNotMatch(install.run, /max_attempts/);
  assert.doesNotMatch(install.run, /until /);
});

test("dependency installation preserves working-directory and frozen-lockfile", () => {
  const install = stepByName("Install dependencies");
  assert.equal(install["working-directory"], "${{ inputs.working-directory }}");
  assert.match(install.run, /pnpm install --frozen-lockfile/);
});

test("executable cache is only saved when freshly acquired; store cache is skipped on an exact hit", () => {
  const saveExe = steps.find((s) => s.name === "Save pnpm executable cache");
  const saveStore = steps.find((s) => s.name === "Save pnpm store cache");
  assert.equal(saveExe.if, "steps.acquire-exe.outcome == 'success'");
  assert.equal(saveStore.if, "steps.restore-store.outputs.cache-hit != 'true'");
});

test("acquisition is attempted whenever the cache missed or the restored executable failed verification", () => {
  const acquire = stepById("acquire-exe");
  assert.equal(
    acquire.if,
    "steps.restore-exe.outputs.cache-hit != 'true' || steps.verify-cached-exe.outputs.valid != 'true'"
  );
});

// --- Dynamic: exercise the actual shell logic for version resolution and
// verification, so a regression in the scripts themselves is caught, not
// just in the surrounding YAML wiring. ---

test("resolves the exact pnpm version from packageManager, stripping an integrity suffix", () => {
  withFixtureDir((dir) => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.15.4+sha256.deadbeef" })
    );
    const result = runStep(stepById("pnpm-version"), { cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.version, "9.15.4");
  });
});

test("fails clearly when packageManager is missing", () => {
  withFixtureDir((dir) => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({}));
    const result = runStep(stepById("pnpm-version"), { cwd: dir });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing a 'packageManager' field/);
  });
});

test("fails clearly when packageManager declares a non-pnpm package manager", () => {
  withFixtureDir((dir) => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.0.0" })
    );
    const result = runStep(stepById("pnpm-version"), { cwd: dir });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not declare pnpm/);
  });
});

function fakeBin(dir, name, script) {
  const binPath = path.join(dir, name);
  writeFileSync(binPath, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(binPath, 0o755);
  return dir;
}

test("verify-cached-exe accepts a cached executable that reports the expected version", () => {
  withFixtureDir((dir) => {
    fakeBin(dir, "pnpm", 'echo "9.15.4"');
    const result = runStep(stepById("verify-cached-exe"), {
      cwd: dir,
      env: { EXPECTED_VERSION: "9.15.4", PNPM_BIN: path.join(dir, "pnpm") }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.valid, "true");
  });
});

test("verify-cached-exe rejects a cached executable reporting the wrong version, without failing the step", () => {
  withFixtureDir((dir) => {
    fakeBin(dir, "pnpm", 'echo "9.0.0"');
    const result = runStep(stepById("verify-cached-exe"), {
      cwd: dir,
      env: { EXPECTED_VERSION: "9.15.4", PNPM_BIN: path.join(dir, "pnpm") }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.valid, "false");
  });
});

test("verify-cached-exe treats a missing/corrupt cached executable as invalid, without failing the step", () => {
  withFixtureDir((dir) => {
    const result = runStep(stepById("verify-cached-exe"), {
      cwd: dir,
      env: {
        EXPECTED_VERSION: "9.15.4",
        PNPM_BIN: path.join(dir, "no-such-binary")
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.valid, "false");
  });
});

test("acquire-exe retries a flaky upstream a bounded number of times, then succeeds", () => {
  withFixtureDir((dir) => {
    const binDir = path.join(dir, "bin");
    mkdirSync(binDir);
    const attemptsFile = path.join(dir, "attempts");
    writeFileSync(attemptsFile, "0");
    // Mocks `npm install --no-save --prefix <exe-root> @pnpm/exe@<version>`:
    // fails twice, then materializes a fake @pnpm/exe layout reporting the
    // requested version.
    fakeBin(
      binDir,
      "npm",
      `
      attempts_file="${attemptsFile}"
      n=$(cat "$attempts_file")
      n=$((n + 1))
      echo "$n" > "$attempts_file"
      # args: install --no-save --prefix <root> @pnpm/exe@<version>
      root="$4"
      version="\${5#@pnpm/exe@}"
      if [ "$n" -lt 3 ]; then
        echo "simulated upstream failure" >&2
        exit 1
      fi
      mkdir -p "$root/node_modules/@pnpm/exe"
      cat > "$root/node_modules/@pnpm/exe/pnpm" <<EOF
#!/usr/bin/env bash
echo "$version"
EOF
      chmod +x "$root/node_modules/@pnpm/exe/pnpm"
      `
    );
    const exeRoot = path.join(dir, "exe-root");
    const result = runStep(stepById("acquire-exe"), {
      cwd: dir,
      path: binDir,
      env: { PNPM_VERSION: "9.15.4", EXE_ROOT: exeRoot }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(attemptsFile, "utf8").trim(), "3");
    assert.equal(
      execFileSync(path.join(exeRoot, "node_modules/@pnpm/exe/pnpm"))
        .toString()
        .trim(),
      "9.15.4"
    );
  });
});

test("acquire-exe fails after exhausting bounded retries against a persistently failing upstream", () => {
  withFixtureDir((dir) => {
    const binDir = path.join(dir, "bin");
    mkdirSync(binDir);
    fakeBin(binDir, "npm", 'echo "simulated upstream failure" >&2; exit 1');
    const result = runStep(stepById("acquire-exe"), {
      cwd: dir,
      path: binDir,
      env: { PNPM_VERSION: "9.15.4", EXE_ROOT: path.join(dir, "exe-root") }
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /failed to acquire @pnpm\/exe@9\.15\.4 from upstream after/
    );
  });
});

test("acquire-exe fails hard (no retry) when the freshly acquired executable reports the wrong version", () => {
  withFixtureDir((dir) => {
    const binDir = path.join(dir, "bin");
    mkdirSync(binDir);
    fakeBin(
      binDir,
      "npm",
      `
      root="$4"
      mkdir -p "$root/node_modules/@pnpm/exe"
      cat > "$root/node_modules/@pnpm/exe/pnpm" <<'EOF'
#!/usr/bin/env bash
echo "0.0.0"
EOF
      chmod +x "$root/node_modules/@pnpm/exe/pnpm"
      `
    );
    const result = runStep(stepById("acquire-exe"), {
      cwd: dir,
      path: binDir,
      env: { PNPM_VERSION: "9.15.4", EXE_ROOT: path.join(dir, "exe-root") }
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /reports version '0\.0\.0', expected '9\.15\.4'/
    );
    assert.doesNotMatch(
      result.stderr,
      /retrying in/,
      "a version mismatch must not be retried"
    );
  });
});
