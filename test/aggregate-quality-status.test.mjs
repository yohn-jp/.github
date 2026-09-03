import test from "node:test";
import assert from "node:assert/strict";
import { aggregateQualityStatus } from "../scripts/aggregate-quality-status.mjs";

const ALL_SUCCESS = {
  "static-quality": "success",
  "supply-chain-security": "success",
  "workflow-security": "success",
  "test-effectiveness": "success"
};

test("all lanes succeeding aggregates to success", () => {
  assert.deepEqual(aggregateQualityStatus(ALL_SUCCESS), {
    status: "success",
    reasons: []
  });
});

test("an optional lane being skipped does not fail the aggregate", () => {
  const { status, reasons } = aggregateQualityStatus({
    ...ALL_SUCCESS,
    "test-effectiveness": "skipped"
  });
  assert.equal(status, "success");
  assert.deepEqual(reasons, []);
});

test("every lane skipped still aggregates to success", () => {
  const { status } = aggregateQualityStatus({
    "static-quality": "skipped",
    "supply-chain-security": "skipped",
    "workflow-security": "skipped",
    "test-effectiveness": "skipped"
  });
  assert.equal(status, "success");
});

for (const failingResult of [
  "failure",
  "cancelled",
  "timed_out",
  "action_required"
]) {
  test(`a single lane reporting ${failingResult} fails the aggregate`, () => {
    const { status, reasons } = aggregateQualityStatus({
      ...ALL_SUCCESS,
      "workflow-security": failingResult
    });
    assert.equal(status, "failure");
    assert.deepEqual(reasons, [`workflow-security: ${failingResult}`]);
  });
}

test("multiple failing lanes are all reported", () => {
  const { status, reasons } = aggregateQualityStatus({
    ...ALL_SUCCESS,
    "static-quality": "failure",
    "test-effectiveness": "cancelled"
  });
  assert.equal(status, "failure");
  assert.deepEqual(reasons, [
    "static-quality: failure",
    "test-effectiveness: cancelled"
  ]);
});

test("an empty or unrecognized result is malformed input and fails closed", () => {
  const { status, reasons } = aggregateQualityStatus({
    ...ALL_SUCCESS,
    "supply-chain-security": ""
  });
  assert.equal(status, "failure");
  assert.deepEqual(reasons, ["supply-chain-security: unrecognized result ''"]);
});

test("a typo'd result value fails closed rather than passing silently", () => {
  const { status, reasons } = aggregateQualityStatus({
    ...ALL_SUCCESS,
    "static-quality": "succes"
  });
  assert.equal(status, "failure");
  assert.deepEqual(reasons, ["static-quality: unrecognized result 'succes'"]);
});
