import assert from "node:assert/strict";
import test from "node:test";

import { parseNewPersonIds } from "../src/batch-input.mjs";

test("new People batch preserves explicit unregistered IDs", () => {
  assert.deepEqual(parseNewPersonIds("9001, 9002\n9003", [1, 31]), [9001, 9002, 9003]);
});

test("new People batch rejects empty, malformed, duplicate, registered, and oversized input", () => {
  assert.throws(() => parseNewPersonIds("", []), /at least one/u);
  assert.throws(() => parseNewPersonIds("12,nope", []), /malformed/u);
  assert.throws(() => parseNewPersonIds("12,12", []), /duplicate/u);
  assert.throws(() => parseNewPersonIds("31", [31]), /already registered/u);
  assert.throws(() => parseNewPersonIds(Array.from({ length: 31 }, (_, index) => index + 1).join(","), []), /cannot exceed 30/u);
});
