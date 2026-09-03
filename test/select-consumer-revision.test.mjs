import test from "node:test";
import assert from "node:assert/strict";
import { selectConsumerRevision } from "../scripts/select-consumer-revision.mjs";

test("pull_request selects the PR head SHA, not the caller SHA", () => {
  const result = selectConsumerRevision({
    eventName: "pull_request",
    prHeadSha: "head-sha",
    callerSha: "merge-ref-sha"
  });
  assert.deepEqual(result, { sha: "head-sha" });
});

test("pull_request with no head SHA fails closed", () => {
  const result = selectConsumerRevision({
    eventName: "pull_request",
    prHeadSha: "",
    callerSha: "merge-ref-sha"
  });
  assert.deepEqual(result, { error: "pull_request head SHA is unavailable" });
});

for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
  test(`${eventName} selects the caller SHA`, () => {
    const result = selectConsumerRevision({
      eventName,
      prHeadSha: "",
      callerSha: "caller-sha"
    });
    assert.deepEqual(result, { sha: "caller-sha" });
  });
}

test("push with no caller SHA fails closed", () => {
  const result = selectConsumerRevision({
    eventName: "push",
    prHeadSha: "",
    callerSha: ""
  });
  assert.deepEqual(result, { error: "caller SHA is unavailable" });
});
