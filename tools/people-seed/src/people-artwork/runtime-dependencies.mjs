import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(packageRoot, "../..");

function firstExisting(candidates, label) {
  const resolved = candidates.filter(Boolean).map((candidate) => path.resolve(candidate));
  for (const candidate of resolved) {
    try {
      require.resolve(path.join(candidate, "package.json"));
      return candidate;
    } catch {}
  }
  throw new Error(`${label} is unavailable. Run npm ci at the repository root. Checked:\n${resolved.map((item) => `- ${item}`).join("\n")}`);
}

function moduleRoot(value, packageName) {
  if (!value) return null;
  const resolved = path.resolve(value);
  if (path.basename(resolved) === "package.json") return path.dirname(resolved);
  if (path.basename(resolved) === packageName) return resolved;
  return path.join(resolved, packageName);
}

export function loadPeopleArtworkRuntime({ sharpPath = null, skiaCanvasPath = null } = {}) {
  const sharpRoot = firstExisting([
    moduleRoot(sharpPath || process.env.NUVIO_SHARP_PATH, "sharp"),
    path.join(repoRoot, "node_modules", "sharp"),
    path.join(packageRoot, "node_modules", "sharp"),
  ], "Sharp 0.35.3");
  const skiaRoot = firstExisting([
    moduleRoot(skiaCanvasPath || process.env.NUVIO_SKIA_CANVAS_PATH, "skia-canvas"),
    path.join(repoRoot, "node_modules", "skia-canvas"),
    path.join(packageRoot, "node_modules", "skia-canvas"),
  ], "skia-canvas 3.0.8");

  const sharp = require(sharpRoot);
  const skia = require(skiaRoot);
  const sharpPackage = require(path.join(sharpRoot, "package.json"));
  const skiaPackage = require(path.join(skiaRoot, "package.json"));
  const versions = {
    sharp: sharpPackage.version,
    libvips: sharp.versions.vips,
    skiaCanvas: skiaPackage.version,
  };
  const expected = { sharp: "0.35.3", libvips: "8.18.3", skiaCanvas: "3.0.8" };
  for (const [name, value] of Object.entries(expected)) {
    if (versions[name] !== value) throw new Error(`People artwork parity requires ${name} ${value}; found ${versions[name]}.`);
  }
  return { sharp, Canvas: skia.Canvas, FontLibrary: skia.FontLibrary, versions, sharpRoot, skiaRoot };
}

export const PEOPLE_ARTWORK_PACKAGE_ROOT = packageRoot;
export const PEOPLE_ARTWORK_REPO_ROOT = repoRoot;
