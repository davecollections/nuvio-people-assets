import assert from "node:assert/strict";
import test from "node:test";

import { parseBatchPersonIds } from "../src/batch-input.mjs";

test("batch input preserves an explicit ordered registered ID list", () => {
  assert.deepEqual(parseBatchPersonIds("31, 47\n8851", new Set([31, 47, 8851])), [31, 47, 8851]);
});

test("batch input rejects empty, malformed, duplicate, and unregistered IDs", () => {
  const registered = new Set([31, 47, 8851]);
  assert.throws(() => parseBatchPersonIds("", registered), /at least one/u);
  assert.throws(() => parseBatchPersonIds("31,all", registered), /malformed/u);
  assert.throws(() => parseBatchPersonIds("031", registered), /malformed/u);
  assert.throws(() => parseBatchPersonIds("31,31", registered), /duplicate/u);
  assert.throws(() => parseBatchPersonIds("31,999", registered), /unregistered/u);
});

test("batch input rejects more than thirty identities", () => {
  const registered = new Set(Array.from({ length: 31 }, (_, index) => index + 1));
  const input = [...registered].join(",");
  assert.throws(() => parseBatchPersonIds(input, registered), /cannot exceed 30/u);
});
