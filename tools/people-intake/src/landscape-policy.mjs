import {
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID
} from "../../people-seed/src/people-artwork/landscape-default-crop.mjs";

export const NEW_PERSON_LANDSCAPE_POLICY_EVIDENCE_VERSION = "nuvio-new-person-landscape-policy-evidence-v1";
export {
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID
};

const APPLIED_STATUSES = new Set(["active-tier-1-slight", "source-bound-maximum"]);
const HASH = /^[a-f0-9]{64}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function selectLandscapeRecord(metadata, { personId, portraitTreatment }) {
  assert(metadata?.version === "people-artwork-render-metadata-v1" && Array.isArray(metadata.records),
    `${personId}: ${portraitTreatment} render metadata is invalid`);
  const records = metadata.records.filter((record) => record?.tmdbPersonId === personId
    && record.formatId === "landscape"
    && record.portraitTreatment === portraitTreatment);
  assert(records.length === 1, `${personId}: expected exactly one ${portraitTreatment} Landscape policy record`);
  return records[0];
}

function validateRecord(record, { personId, hasProfile, portraitTreatment, reviewedOverride = null }) {
  if (hasProfile && reviewedOverride) {
    const { record: configured, recordHash } = reviewedOverride;
    const expectedBounds = {
      x: configured.cropOffsetX,
      y: configured.cropOffsetY,
      width: Math.round(configured.cropRectangle.width * configured.cropScale.x),
      height: Math.round(configured.cropRectangle.height * configured.cropScale.y)
    };
    assert(record.fallbackUsed === false && record.cropOverrideUsed !== true,
      `${personId}: ${portraitTreatment} reviewed Landscape unexpectedly used fallback or a legacy crop override`);
    assert(record.landscapeDefaultCropPolicyId === undefined,
      `${personId}: ${portraitTreatment} reviewed Landscape also recorded the default chin-safe policy`);
    assert(record.reviewedArtworkOverrideUsed === true
      && record.reviewedArtworkOverrideId === `${configured.stableKey}/landscape`
      && record.reviewedArtworkOverrideRecordHash === recordHash
      && record.reviewedArtworkOverrideSourceHash === configured.sourceHash
      && record.reviewedArtworkOverrideStatus === "active-source-match"
      && record.reviewedArtworkOverrideReason === configured.reason,
    `${personId}: ${portraitTreatment} Landscape is not bound to the reviewed chin-safe correction`);
    assert(record.sourceHash === configured.sourceHash
      && record.profilePathAttempted === configured.sourceProfilePath
      && record.presetId === configured.basePresetId
      && record.presetHash === configured.basePresetHash,
    `${personId}: ${portraitTreatment} reviewed Landscape source or preset changed`);
    assert(record.cropMethod === configured.cropStrategy
      && JSON.stringify(record.cropRectangle) === JSON.stringify(configured.cropRectangle)
      && JSON.stringify(record.resizeScale) === JSON.stringify(configured.cropScale)
      && JSON.stringify(record.portraitBounds) === JSON.stringify(expectedBounds),
    `${personId}: ${portraitTreatment} reviewed Landscape geometry changed`);
    assert(HASH.test(record.outputHash || ""), `${personId}: ${portraitTreatment} Landscape output hash is invalid`);
    return;
  }
  assert(record.landscapeDefaultCropPolicyId === PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
    `${personId}: ${portraitTreatment} Landscape did not use the locked chin-safe policy`);
  assert(record.landscapeDefaultCropPolicyHash === PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
    `${personId}: ${portraitTreatment} Landscape chin-safe policy hash changed`);
  assert(HASH.test(record.outputHash || ""), `${personId}: ${portraitTreatment} Landscape output hash is invalid`);
  assert(record.cropOverrideUsed !== true, `${personId}: ${portraitTreatment} Landscape unexpectedly bypassed the net-new chin-safe policy`);

  if (hasProfile) {
    assert(record.fallbackUsed === false && APPLIED_STATUSES.has(record.landscapeDefaultCropStatus),
      `${personId}: ${portraitTreatment} profile Landscape has no applied chin-safe result`);
    assert(record.landscapeDefaultCropTier === "tier-1-slight",
      `${personId}: ${portraitTreatment} Landscape changed the locked chin-safe tier`);
    assert(HASH.test(record.sourceHash || "") && record.landscapeDefaultCropSourceHash === record.sourceHash,
      `${personId}: ${portraitTreatment} Landscape chin-safe evidence is not source-bound`);
    assert(record.landscapeDefaultCropSourceBoundLimited === (record.landscapeDefaultCropStatus === "source-bound-maximum"),
      `${personId}: ${portraitTreatment} Landscape source-bound status is inconsistent`);
    assert(record.cropMethod === (record.landscapeDefaultCropStatus === "source-bound-maximum"
      ? "net-new-tier-1-source-bound-maximum-v1"
      : "net-new-tier-1-slight-landscape-v1"),
    `${personId}: ${portraitTreatment} Landscape crop method differs from the locked chin-safe policy`);
    assert(record.portraitBounds?.x + record.portraitBounds?.width === 1098
      && record.portraitBounds?.y === 0
      && record.portraitBounds?.width === 594
      && record.portraitBounds?.height === 675,
    `${personId}: ${portraitTreatment} Landscape changed the locked chin-safe placement`);
    assert(record.cropRectangle && record.resizeScale,
      `${personId}: ${portraitTreatment} Landscape chin-safe geometry is incomplete`);
  } else {
    assert(record.fallbackUsed === true
      && record.landscapeDefaultCropStatus === "source-unavailable-fallback"
      && record.landscapeDefaultCropTier === null
      && record.landscapeDefaultCropSourceHash === null
      && record.landscapeDefaultCropSourceBoundLimited === false,
    `${personId}: profile-free Landscape did not record the chin-safe fallback boundary`);
  }
}

function compactRecord(record, reviewedOverride = null) {
  if (reviewedOverride) {
    return {
      portraitTreatment: record.portraitTreatment,
      outputHash: record.outputHash,
      status: "reviewed-source-bound-override",
      tier: reviewedOverride.record.prototypeTier,
      sourceHash: record.sourceHash,
      sourceBoundLimited: false,
      cropMethod: record.cropMethod,
      cropRectangle: record.cropRectangle,
      resizeScale: record.resizeScale,
      portraitBounds: record.portraitBounds,
      overrideId: record.reviewedArtworkOverrideId,
      overrideRecordHash: record.reviewedArtworkOverrideRecordHash
    };
  }
  return {
    portraitTreatment: record.portraitTreatment,
    outputHash: record.outputHash,
    status: record.landscapeDefaultCropStatus,
    tier: record.landscapeDefaultCropTier,
    sourceHash: record.landscapeDefaultCropSourceHash,
    sourceBoundLimited: record.landscapeDefaultCropSourceBoundLimited,
    cropMethod: record.cropMethod,
    cropRectangle: record.cropRectangle,
    resizeScale: record.resizeScale,
    portraitBounds: record.portraitBounds
  };
}

export function buildNewPersonLandscapePolicyEvidence({
  personId,
  hasProfile,
  monochromeMetadata,
  focusMetadata = null,
  artworkOverrideConfiguration = null
} = {}) {
  assert(Number.isSafeInteger(personId) && personId > 0, "Landscape policy evidence requires a positive Person ID");
  assert(typeof hasProfile === "boolean", `${personId}: Landscape policy evidence requires an explicit profile state`);
  const reviewedOverride = artworkOverrideConfiguration?.recordsByKey?.get(`person:${personId}/landscape`) || null;
  const monochrome = selectLandscapeRecord(monochromeMetadata, { personId, portraitTreatment: "monochrome-warm" });
  validateRecord(monochrome, { personId, hasProfile, portraitTreatment: "monochrome-warm", reviewedOverride });

  let focus = null;
  if (hasProfile) {
    focus = selectLandscapeRecord(focusMetadata, { personId, portraitTreatment: "colour-focus" });
    validateRecord(focus, { personId, hasProfile, portraitTreatment: "colour-focus", reviewedOverride });
    for (const field of ["landscapeDefaultCropStatus", "landscapeDefaultCropTier", "landscapeDefaultCropSourceHash",
      "landscapeDefaultCropSourceBoundLimited", "cropMethod", "cropRectangle", "resizeScale", "portraitBounds",
      "reviewedArtworkOverrideId", "reviewedArtworkOverrideRecordHash", "reviewedArtworkOverrideSourceHash",
      "reviewedArtworkOverrideStatus", "reviewedArtworkOverrideReason"]) {
      assert(JSON.stringify(monochrome[field]) === JSON.stringify(focus[field]),
        `${personId}: monochrome and focus Landscapes differ in chin-safe ${field}`);
    }
  } else {
    assert(focusMetadata === null, `${personId}: profile-free candidate unexpectedly has focus Landscape metadata`);
  }

  return {
    version: NEW_PERSON_LANDSCAPE_POLICY_EVIDENCE_VERSION,
    policyId: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
    policyHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
    hasProfile,
    monochrome: compactRecord(monochrome, reviewedOverride),
    focus: focus ? compactRecord(focus, reviewedOverride) : null,
    ...(reviewedOverride ? {
      reviewedOverride: {
        overrideId: `${reviewedOverride.record.stableKey}/landscape`,
        recordHash: reviewedOverride.recordHash,
        tier: reviewedOverride.record.prototypeTier
      }
    } : {})
  };
}
