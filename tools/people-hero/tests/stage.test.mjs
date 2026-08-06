import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { executableForSpawn } from "../src/stage.mjs";

test("bare Python commands remain PATH-resolved", () => {
  assert.equal(executableForSpawn("python"), "python");
  assert.equal(executableForSpawn("python3"), "python3");
});

test("explicit Python paths remain explicit absolute paths", () => {
  const absolute = path.resolve("runtime", "python.exe");
  assert.equal(executableForSpawn(absolute), absolute);
  assert.equal(executableForSpawn("./runtime/python"), path.resolve("runtime", "python"));
});
