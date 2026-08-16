import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateAgainstSchema } from "../../people-seed/src/schema-validator.mjs";

export const NEW_PERSON_ARTWORK_OVERRIDE_VERSION = "people-intake-artwork-overrides-v1";
export const NEW_PERSON_ARTWORK_OVERRIDE_PATH = "data/people-intake-artwork-overrides.json";
export const NEW_PERSON_ARTWORK_OVERRIDE_SCHEMA_PATH = "schemas/people-intake-artwork-overrides.schema.json";

const FORMAT_ORDER = new Map([["landscape", 0], ["poster", 1]]);
const HASH = /^[a-f0-9]{64}$/u;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function recordKey(record) {
  return `${record.stableKey}/${record.formatId}`;
}

function effectiveBounds(record) {
  return {
    x: record.cropOffsetX,
    y: record.cropOffsetY,
    width: Math.round(record.cropRectangle.width * record.cropScale.x),
    height: Math.round(record.cropRectangle.height * record.cropScale.y),
  };
}

function validateRecordSemantics(record, previous, keys) {
  const key = recordKey(record);
  if (keys.has(key)) return `${key}: duplicate reviewed artwork override`;
  keys.add(key);
  if (record.stableKey !== `person:${record.tmdbPersonId}`) return `${key}: stable key and TMDB Person ID differ`;
  if (previous && (previous.tmdbPersonId > record.tmdbPersonId
    || (previous.tmdbPersonId === record.tmdbPersonId
      && FORMAT_ORDER.get(previous.formatId) >= FORMAT_ORDER.get(record.formatId)))) {
    return "reviewed artwork overrides must use ascending Person ID then format order";
  }
  const bounds = effectiveBounds(record);
  const canvas = record.formatId === "landscape" ? { width: 1200, height: 675 } : { width: 1000, height: 1500 };
  if (bounds.x + bounds.width > canvas.width || bounds.y + bounds.height > canvas.height) {
    return `${key}: effective portrait bounds exceed the ${canvas.width}x${canvas.height} canvas`;
  }
  if (record.formatId === "landscape") {
    if (record.basePresetId !== "people-landscape-cormorant-v1"
      || record.cropStrategy !== "owner-reviewed-full-portrait-landscape-v1"
      || record.reason !== "owner-review-chin-safe-correction-20260816"
      || record.prototypeTier !== "tier-2-full-portrait"
      || record.posterTypography !== undefined
      || record.posterLowerBandStartY !== undefined
      || JSON.stringify(bounds) !== JSON.stringify({ x: 648, y: 0, width: 450, height: 675 })) {
      return `${key}: Landscape override differs from the approved full-portrait tier`;
    }
  } else if (record.formatId === "poster") {
    if (record.basePresetId !== "people-poster-cormorant-v1"
      || record.cropStrategy !== "owner-reviewed-face-clear-bottom-band-poster-v1"
      || record.reason !== "owner-review-keep-name-clear-of-face-20260816"
      || record.prototypeTier !== undefined
      || JSON.stringify(bounds) !== JSON.stringify({ x: 50, y: 0, width: 900, height: 1350 })
      || JSON.stringify(record.posterTypography) !== JSON.stringify({
        requestedFontSize: 96,
        region: { x: 72, y: 1340, width: 856, height: 150 },
        maximumWidth: 856,
        maximumHeight: 150,
      })
      || record.posterLowerBandStartY !== 1260) {
      return `${key}: Poster override differs from the approved face-clear treatment`;
    }
  }
  return null;
}

export function validateNewPersonArtworkOverrides(document, schema) {
  const errors = validateAgainstSchema(document, schema, "people-intake-artwork-overrides.json");
  if (document?.recordCount !== document?.records?.length) {
    errors.push("reviewed artwork override recordCount must equal records length");
  }
  const keys = new Set();
  let previous = null;
  for (const record of document?.records || []) {
    const error = validateRecordSemantics(record, previous, keys);
    if (error) errors.push(error);
    previous = record;
  }
  return errors;
}

export async function loadNewPersonArtworkOverrides({ repositoryRoot } = {}) {
  assert(typeof repositoryRoot === "string" && repositoryRoot.trim(), "Reviewed artwork overrides require the repository root");
  const configPath = path.join(repositoryRoot, NEW_PERSON_ARTWORK_OVERRIDE_PATH);
  const schemaPath = path.join(repositoryRoot, NEW_PERSON_ARTWORK_OVERRIDE_SCHEMA_PATH);
  const [buffer, schemaBuffer] = await Promise.all([fs.readFile(configPath), fs.readFile(schemaPath)]);
  const config = JSON.parse(buffer);
  const schema = JSON.parse(schemaBuffer);
  const errors = validateNewPersonArtworkOverrides(config, schema);
  if (errors.length) {
    throw new Error(`Reviewed new People artwork overrides failed validation:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const recordsByKey = new Map(config.records.map((record) => [recordKey(record), {
    record,
    recordHash: sha256(Buffer.from(JSON.stringify(record))),
  }]));
  return {
    version: config.version,
    config,
    configHash: sha256(buffer),
    configPath,
    schemaPath,
    recordsByKey,
    recordsForPerson(personId) {
      return config.records.filter((record) => record.tmdbPersonId === personId);
    },
  };
}

export class ReviewedArtworkOverrideSourceMismatchError extends Error {
  constructor({ person, formatId, record, source }) {
    super(`reviewed-artwork-override-source-mismatch:${person.stableKey}/${formatId}: expected ${record.sourceHash}, received ${source?.sourceHash ?? "unavailable"}`);
    this.name = "ReviewedArtworkOverrideSourceMismatchError";
    this.code = "reviewed-artwork-override-source-mismatch";
    this.stableKey = person.stableKey;
    this.formatId = formatId;
    this.expectedSourceHash = record.sourceHash;
    this.actualSourceHash = source?.sourceHash ?? null;
  }
}

export function resolveNewPersonArtworkOverride({ person, source, formatId, configuration } = {}) {
  if (!configuration) return { used: false, status: "configuration-unavailable" };
  const selected = configuration.recordsByKey.get(`${person.stableKey}/${formatId}`);
  if (!selected || selected.record.status !== "active") return { used: false, status: "not-configured" };
  const { record, recordHash } = selected;
  assert(record.tmdbPersonId === person.tmdbPersonId && record.canonicalName === person.canonicalName,
    `${person.stableKey}/${formatId}: reviewed artwork override identity mismatch`);
  if (!source?.available || source.sourceHash !== record.sourceHash || source.profilePathAttempted !== record.sourceProfilePath) {
    throw new ReviewedArtworkOverrideSourceMismatchError({ person, formatId, record, source });
  }
  assert(HASH.test(recordHash), `${person.stableKey}/${formatId}: reviewed artwork override record hash is invalid`);
  return {
    used: true,
    id: `${person.stableKey}/${formatId}`,
    status: "active-source-match",
    recordHash,
    record,
  };
}

function compactMetadataRecord(record) {
  return {
    portraitTreatment: record.portraitTreatment,
    outputHash: record.outputHash,
    sourceHash: record.sourceHash,
    cropMethod: record.cropMethod,
    cropRectangle: record.cropRectangle,
    resizeScale: record.resizeScale,
    portraitBounds: record.portraitBounds,
    requestedFontSize: record.requestedFontSize,
    finalFontSize: record.finalFontSize,
    textBounds: record.textBounds,
    overrideId: record.reviewedArtworkOverrideId,
    overrideRecordHash: record.reviewedArtworkOverrideRecordHash,
    overrideStatus: record.reviewedArtworkOverrideStatus,
    overrideReason: record.reviewedArtworkOverrideReason,
  };
}

function selectRecord(metadata, { personId, formatId, portraitTreatment }) {
  assert(metadata?.version === "people-artwork-render-metadata-v1" && Array.isArray(metadata.records),
    `${personId}: ${portraitTreatment} render metadata is invalid`);
  const records = metadata.records.filter((record) => record.tmdbPersonId === personId
    && record.formatId === formatId
    && record.portraitTreatment === portraitTreatment);
  assert(records.length === 1, `${personId}: expected one ${portraitTreatment} ${formatId} record`);
  return records[0];
}

function validateMetadataAgainstOverride(metadataRecord, selected, portraitTreatment) {
  const { record, recordHash } = selected;
  const bounds = effectiveBounds(record);
  assert(metadataRecord.reviewedArtworkOverrideUsed === true
    && metadataRecord.reviewedArtworkOverrideId === `${record.stableKey}/${record.formatId}`
    && metadataRecord.reviewedArtworkOverrideRecordHash === recordHash
    && metadataRecord.reviewedArtworkOverrideSourceHash === record.sourceHash
    && metadataRecord.reviewedArtworkOverrideStatus === "active-source-match"
    && metadataRecord.reviewedArtworkOverrideReason === record.reason,
  `${record.stableKey}/${record.formatId}: render metadata is not bound to the reviewed override`);
  assert(metadataRecord.sourceHash === record.sourceHash
    && metadataRecord.profilePathAttempted === record.sourceProfilePath
    && metadataRecord.presetId === record.basePresetId
    && metadataRecord.presetHash === record.basePresetHash,
  `${record.stableKey}/${record.formatId}: reviewed override source or preset changed`);
  assert(metadataRecord.cropMethod === record.cropStrategy
    && JSON.stringify(metadataRecord.cropRectangle) === JSON.stringify(record.cropRectangle)
    && JSON.stringify(metadataRecord.resizeScale) === JSON.stringify(record.cropScale)
    && JSON.stringify(metadataRecord.portraitBounds) === JSON.stringify(bounds),
  `${record.stableKey}/${record.formatId}: reviewed override geometry changed`);
  assert(HASH.test(metadataRecord.outputHash || ""),
    `${record.stableKey}/${record.formatId}: ${portraitTreatment} output hash is invalid`);
  if (record.formatId === "poster") {
    assert(metadataRecord.requestedFontSize === record.posterTypography.requestedFontSize
      && JSON.stringify(metadataRecord.reviewedArtworkOverrideTypography) === JSON.stringify(record.posterTypography)
      && metadataRecord.reviewedArtworkOverrideLowerBandStartY === record.posterLowerBandStartY,
    `${record.stableKey}/poster: approved face-clear typography or lower band changed`);
  }
}

export function buildNewPersonArtworkOverrideEvidence({
  personId,
  monochromeMetadata,
  focusMetadata,
  configuration,
} = {}) {
  assert(Number.isSafeInteger(personId) && personId > 0, "Reviewed artwork override evidence requires a positive Person ID");
  assert(configuration?.version === NEW_PERSON_ARTWORK_OVERRIDE_VERSION,
    `${personId}: reviewed artwork override configuration is unavailable`);
  const configured = configuration.recordsForPerson(personId);
  if (!configured.length) return null;
  const records = configured.map((configuredRecord) => {
    const selected = configuration.recordsByKey.get(recordKey(configuredRecord));
    const monochrome = selectRecord(monochromeMetadata, {
      personId,
      formatId: configuredRecord.formatId,
      portraitTreatment: "monochrome-warm",
    });
    const focus = selectRecord(focusMetadata, {
      personId,
      formatId: configuredRecord.formatId,
      portraitTreatment: "colour-focus",
    });
    validateMetadataAgainstOverride(monochrome, selected, "monochrome-warm");
    validateMetadataAgainstOverride(focus, selected, "colour-focus");
    for (const field of ["sourceHash", "cropMethod", "cropRectangle", "resizeScale", "portraitBounds",
      "requestedFontSize", "finalFontSize", "textBounds", "reviewedArtworkOverrideId",
      "reviewedArtworkOverrideRecordHash", "reviewedArtworkOverrideStatus", "reviewedArtworkOverrideReason",
      "reviewedArtworkOverrideTypography", "reviewedArtworkOverrideLowerBandStartY"]) {
      assert(JSON.stringify(monochrome[field]) === JSON.stringify(focus[field]),
        `${configuredRecord.stableKey}/${configuredRecord.formatId}: monochrome and focus override ${field} differ`);
    }
    return {
      overrideId: recordKey(configuredRecord),
      recordHash: selected.recordHash,
      formatId: configuredRecord.formatId,
      sourceProfilePath: configuredRecord.sourceProfilePath,
      sourceHash: configuredRecord.sourceHash,
      basePresetId: configuredRecord.basePresetId,
      basePresetHash: configuredRecord.basePresetHash,
      reason: configuredRecord.reason,
      approvedProofs: { ...configuredRecord.approvedProofs },
      monochrome: compactMetadataRecord(monochrome),
      focus: compactMetadataRecord(focus),
    };
  });
  return {
    version: "nuvio-new-person-artwork-override-evidence-v1",
    configurationVersion: configuration.version,
    records,
  };
}
