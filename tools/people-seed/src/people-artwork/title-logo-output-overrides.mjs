import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { PEOPLE_ARTWORK_REPO_ROOT } from "./runtime-dependencies.mjs";

const configurationPath = path.join(PEOPLE_ARTWORK_REPO_ROOT, "data", "people-base", "title-logo-output-overrides.json");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export async function loadTitleLogoOutputOverrides({ registry = null } = {}) {
  const document = JSON.parse(await fs.readFile(configurationPath, "utf8"));
  if (document.version !== "people-title-logo-output-overrides-v1" || document.recordCount !== document.records?.length) {
    throw new Error("People title-logo output overrides are invalid.");
  }
  const registryById = registry ? new Map(registry.records.map((record) => [record.tmdbPersonId, record])) : null;
  let previousId = 0;
  for (const record of document.records) {
    if (record.tmdbPersonId <= previousId || record.stableKey !== `person:${record.tmdbPersonId}`) throw new Error("People title-logo output overrides are not in deterministic identity order.");
    const person = registryById?.get(record.tmdbPersonId);
    if (registryById && (!person || person.canonicalName !== record.canonicalName)) throw new Error(`${record.stableKey}: title-logo output override identity drifted.`);
    previousId = record.tmdbPersonId;
  }
  return { document, byId: new Map(document.records.map((record) => [record.tmdbPersonId, record])) };
}

export async function applyTitleLogoOutputOverride({ person, rendered, runtime, overrides } = {}) {
  const override = overrides?.byId.get(person.tmdbPersonId) || null;
  if (!override) return { ...rendered, outputOverride: null };
  const inputHash = sha256(rendered.output);
  if (inputHash !== override.inputSha256) throw new Error(`${person.stableKey}: title-logo output override input hash drifted.`);
  const output = await runtime.sharp(rendered.output)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: override.trimThreshold })
    .extend({
      top: override.transparentPadding,
      bottom: override.transparentPadding,
      left: override.transparentPadding,
      right: override.transparentPadding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  const metadata = await runtime.sharp(output, { failOn: "error" }).metadata();
  const outputHash = sha256(output);
  if (metadata.width !== override.outputWidth || metadata.height !== override.outputHeight || outputHash !== override.outputSha256) {
    throw new Error(`${person.stableKey}: title-logo output override no longer reproduces its approved bytes.`);
  }
  return {
    output,
    outputOverride: override,
    record: {
      ...rendered.record,
      canvasWidth: metadata.width,
      canvasHeight: metadata.height,
      outputHash,
      byteCount: output.length,
      outputOverrideOperation: override.operation,
      outputOverrideInputHash: inputHash,
      outputOverridePadding: override.transparentPadding,
    },
  };
}
