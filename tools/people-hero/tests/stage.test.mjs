import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { encodeCandidateBuffer, executableForSpawn, sourceArtworkForCredit } from "../src/stage.mjs";

test("bare Python commands remain PATH-resolved", () => {
  assert.equal(executableForSpawn("python"), "python");
  assert.equal(executableForSpawn("python3"), "python3");
});

test("explicit Python paths remain explicit absolute paths", () => {
  const absolute = path.resolve("runtime", "python.exe");
  assert.equal(executableForSpawn(absolute), absolute);
  assert.equal(executableForSpawn("./runtime/python"), path.resolve("runtime", "python"));
});

test("sparse fallback downloads one preferred official artwork source per credit", () => {
  const both = { posterPath: "/poster.jpg", backdropPath: "/backdrop.jpg" };
  const backdropOnly = { posterPath: null, backdropPath: "/backdrop.jpg" };
  assert.deepEqual(sourceArtworkForCredit(both, "sparse-fallback"), {
    portraitPath: "/poster.jpg",
    landscapePath: null
  });
  assert.deepEqual(sourceArtworkForCredit(backdropOnly, "sparse-fallback"), {
    portraitPath: null,
    landscapePath: "/backdrop.jpg"
  });
  assert.deepEqual(sourceArtworkForCredit(both, "filmography"), {
    portraitPath: "/poster.jpg",
    landscapePath: "/backdrop.jpg"
  });
});

test("sparse fallback cinematic defocus is deterministic, locked, and contains no title-logo input", async () => {
  const input = await sharp({
    create: { width: 2560, height: 1440, channels: 3, background: "#b74835" }
  }).png().toBuffer();
  const preset = {
    width: 2560,
    height: 1440,
    quality: 82,
    sparseFallback: { blurSigma: 34, saturation: 0.82, brightness: 0.7 }
  };
  const [first, second] = await Promise.all([
    encodeCandidateBuffer({ input, preset, outcome: "sparse-fallback" }),
    encodeCandidateBuffer({ input, preset, outcome: "sparse-fallback" })
  ]);
  const metadata = await sharp(first).metadata();
  assert.equal(crypto.createHash("sha256").update(first).digest("hex"),
    crypto.createHash("sha256").update(second).digest("hex"));
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 2560);
  assert.equal(metadata.height, 1440);
});

test("skipped hero evidence remains bound to the locked preset", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    new URL("../src/stage.mjs", import.meta.url),
    "utf8"
  ));
  assert.match(source, /status: "skipped"[\s\S]*preset: preflight\.preset/u);
  assert.match(source, /status: "skipped"[\s\S]*selection/u);
});
