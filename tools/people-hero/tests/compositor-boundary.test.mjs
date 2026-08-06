import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("vendored compositor is network-free and credential-free", async () => {
  const source = await readFile(path.resolve("tools/people-hero/vendor/prism-t2-compositor.py"), "utf8");
  assert.doesNotMatch(source, /(?:requests|urllib|httpx|aiohttp)\s*(?:\.|import)/u);
  assert.doesNotMatch(source, /(?:api[_-]?key|bearer[_-]?token|dotenv|\.env)/iu);
  assert.match(source, /Adapted from Prism Wallpapers by bramst0ne/u);
  assert.match(source, /fraction = max\(0\.0, min\(1\.0, fraction\)\)/u);
});
