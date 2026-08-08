import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { PEOPLE_ARTWORK_PACKAGE_ROOT, PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

const lockPath = path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "config", "cormorant-garamond-700.json");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function readFontLock() {
  return JSON.parse(await fs.readFile(lockPath, "utf8"));
}

export function parseFvar(buffer) {
  const numTables = buffer.readUInt16BE(4);
  let offset = null;
  let length = null;
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    if (buffer.toString("ascii", record, record + 4) === "fvar") {
      offset = buffer.readUInt32BE(record + 8);
      length = buffer.readUInt32BE(record + 12);
      break;
    }
  }
  if (offset === null) throw new Error("Cormorant Garamond fvar table is unavailable.");
  const axesOffset = buffer.readUInt16BE(offset + 4);
  const axisCount = buffer.readUInt16BE(offset + 8);
  const axisSize = buffer.readUInt16BE(offset + 10);
  const axes = [];
  for (let index = 0; index < axisCount; index += 1) {
    const axis = offset + axesOffset + index * axisSize;
    axes.push({
      tag: buffer.toString("ascii", axis, axis + 4),
      minimum: buffer.readInt32BE(axis + 4) / 65536,
      default: buffer.readInt32BE(axis + 8) / 65536,
      maximum: buffer.readInt32BE(axis + 12) / 65536,
    });
  }
  return { fvarOffset: offset, fvarLength: length, axes };
}

function runFamilies(metrics) {
  return [...new Set((metrics.lines || []).flatMap((line) => (line.runs || []).map((run) => run.family)))];
}

export async function discoverFontCache({ fontDirectory = null } = {}) {
  const lock = await readFontLock();
  const candidates = [
    fontDirectory,
    process.env.NUVIO_PEOPLE_FONT_DIR,
    path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, "vendor", lock.cacheDirectoryName),
    path.join(PEOPLE_ARTWORK_PACKAGE_ROOT, ".work", "fonts", lock.cacheDirectoryName),
    path.join(PEOPLE_ARTWORK_REPO_ROOT, lock.legacyApprovedCache),
  ].filter(Boolean).map((item) => path.resolve(item));
  for (const directory of candidates) {
    const fontPath = path.join(directory, lock.fontFileName);
    const licencePath = path.join(directory, lock.licenceFileName);
    if (await exists(fontPath) && await exists(licencePath)) return { directory, fontPath, licencePath, candidates };
  }
  throw new Error(`Approved Cormorant Garamond input is unavailable. Restore the vendored OFL font pair. Checked:\n${candidates.map((item) => `- ${item}`).join("\n")}`);
}

export async function verifyFont({ Canvas, FontLibrary, names = [], requiredWeights = null, fontDirectory = null } = {}) {
  const lock = await readFontLock();
  const cache = await discoverFontCache({ fontDirectory });
  const [fontBuffer, licenceBuffer] = await Promise.all([fs.readFile(cache.fontPath), fs.readFile(cache.licencePath)]);
  const fontHash = sha256(fontBuffer);
  const licenceHash = sha256(licenceBuffer);
  if (fontHash !== lock.fontSha256) throw new Error(`Cormorant font hash mismatch: ${fontHash}`);
  if (licenceHash !== lock.licenceSha256) throw new Error(`Cormorant licence hash mismatch: ${licenceHash}`);
  const variation = parseFvar(fontBuffer);
  const weightAxis = variation.axes.find((axis) => axis.tag === lock.weightAxis.tag);
  const weights = [...new Set(requiredWeights || [lock.weight])].sort((left, right) => left - right);
  if (!weightAxis || weights.some((weight) => weightAxis.minimum > weight || weightAxis.maximum < weight)) throw new Error(`Cormorant Garamond required weights are unavailable: ${weights.join(", ")}.`);
  FontLibrary.reset();
  const loaded = FontLibrary.use(lock.registrationAlias, cache.fontPath);
  if (!FontLibrary.has(lock.registrationAlias)) throw new Error("Exact cached Cormorant font registration failed.");
  const glyphCoverage = [];
  for (const weight of weights) {
    for (const text of [...new Set(names)].sort((left, right) => left.localeCompare(right))) {
      const canvas = new Canvas(3200, 300);
      const context = canvas.getContext("2d");
      context.font = `${weight} 96px "${lock.registrationAlias}"`;
      const families = runFamilies(context.measureText(text));
      const covered = families.length > 0 && families.every((family) => family === lock.family);
      if (!covered) throw new Error(`Required glyph fallback detected for ${text} at weight ${weight}: ${families.join(", ")}`);
      glyphCoverage.push({ text, weight, families, covered });
    }
  }
  return {
    valid: true,
    family: lock.family,
    registrationAlias: lock.registrationAlias,
    weight: lock.weight,
    genuineWeight700: true,
    verifiedWeights: weights,
    fontHash,
    licence: lock.licence,
    licenceHash,
    fontSourceRevision: lock.fontSourceRevision,
    fontSourceUrl: lock.fontSourceUrl,
    licenceSourceUrl: lock.licenceSourceUrl,
    variation,
    glyphCoverage,
    fontPath: cache.fontPath,
    licencePath: cache.licencePath,
    loaded,
  };
}

export { runFamilies };
