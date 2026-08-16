import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPreflight } from "../../people-hero/src/preflight.mjs";
import { renderPeopleArtwork } from "../../people-seed/src/people-artwork/renderer.mjs";
import {
  buildNewPersonLandscapePolicyEvidence,
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
  PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID
} from "../src/landscape-policy.mjs";
import {
  buildNewPersonArtworkOverrideEvidence,
  loadNewPersonArtworkOverrides,
  resolveNewPersonArtworkOverride
} from "../src/artwork-overrides.mjs";
import {
  assertNewPersonWorkPath,
  buildReviewApprovalTemplate,
  candidateOutputDefinitions,
  parseNewPersonStageArguments,
  selectBaseProfile,
  suggestCategoryMembership
} from "../src/stage.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function landscapeRecord({ personId = 9001, portraitTreatment = "monochrome-warm", hasProfile = true } = {}) {
  return {
    tmdbPersonId: personId,
    formatId: "landscape",
    portraitTreatment,
    fallbackUsed: !hasProfile,
    outputHash: portraitTreatment === "monochrome-warm" ? "a".repeat(64) : "b".repeat(64),
    sourceHash: hasProfile ? "c".repeat(64) : null,
    cropMethod: hasProfile ? "net-new-tier-1-slight-landscape-v1" : null,
    cropRectangle: hasProfile ? { left: 0, top: 0, width: 1250, height: 1420 } : null,
    resizeScale: hasProfile ? { x: 0.4752, y: 0.475352 } : null,
    portraitBounds: hasProfile ? { x: 504, y: 0, width: 594, height: 675 } : null,
    landscapeDefaultCropPolicyId: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID,
    landscapeDefaultCropPolicyHash: PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_HASH,
    landscapeDefaultCropStatus: hasProfile ? "active-tier-1-slight" : "source-unavailable-fallback",
    landscapeDefaultCropTier: hasProfile ? "tier-1-slight" : null,
    landscapeDefaultCropSourceHash: hasProfile ? "c".repeat(64) : null,
    landscapeDefaultCropSourceBoundLimited: false
  };
}

function renderMetadata(record) {
  return { version: "people-artwork-render-metadata-v1", records: Array.isArray(record) ? record : [record] };
}

function reviewedMetadataRecord(selected, portraitTreatment) {
  const { record, recordHash } = selected;
  const poster = record.formatId === "poster";
  const result = {
    tmdbPersonId: record.tmdbPersonId,
    formatId: record.formatId,
    portraitTreatment,
    fallbackUsed: false,
    outputHash: portraitTreatment === "monochrome-warm"
      ? record.approvedProofs.monochromeWarmSha256
      : record.approvedProofs.colourFocusSha256,
    sourceHash: record.sourceHash,
    profilePathAttempted: record.sourceProfilePath,
    presetId: record.basePresetId,
    presetHash: record.basePresetHash,
    cropMethod: record.cropStrategy,
    cropRectangle: record.cropRectangle,
    resizeScale: record.cropScale,
    portraitBounds: {
      x: record.cropOffsetX,
      y: record.cropOffsetY,
      width: Math.round(record.cropRectangle.width * record.cropScale.x),
      height: Math.round(record.cropRectangle.height * record.cropScale.y)
    },
    requestedFontSize: poster ? record.posterTypography.requestedFontSize : 84,
    finalFontSize: poster ? 96 : 84,
    textBounds: poster
      ? { x: 151.135, y: 1366.5, width: 697.73, height: 97 }
      : { x: 72, y: 310.5, width: 469.39, height: 161 },
    reviewedArtworkOverrideUsed: true,
    reviewedArtworkOverrideId: `${record.stableKey}/${record.formatId}`,
    reviewedArtworkOverrideRecordHash: recordHash,
    reviewedArtworkOverrideSourceHash: record.sourceHash,
    reviewedArtworkOverrideStatus: "active-source-match",
    reviewedArtworkOverrideReason: record.reason
  };
  if (poster) {
    result.reviewedArtworkOverrideTypography = record.posterTypography;
    result.reviewedArtworkOverrideLowerBandStartY = record.posterLowerBandStartY;
  }
  return result;
}

test("new People stage input requires exactly one positive ID", () => {
  assert.equal(parseNewPersonStageArguments(["--person-id", "9001"]).personId, 9001);
  assert.throws(() => parseNewPersonStageArguments([]), /exactly one/u);
  assert.throws(() => parseNewPersonStageArguments(["--person-id", "0"]), /Invalid/u);
  assert.throws(() => parseNewPersonStageArguments(["--person-id", "9001", "--unexpected"]), /Unknown/u);
});

test("base profile selection prefers TMDB default then deterministic portrait fallback", () => {
  const profiles = [
    { file_path: "/lower.jpg", width: 1000, height: 1500, vote_count: 5, vote_average: 8 },
    { file_path: "/higher.jpg", width: 800, height: 1200, vote_count: 20, vote_average: 7 },
    { file_path: "/landscape.jpg", width: 1600, height: 900, vote_count: 100, vote_average: 10 }
  ];
  assert.equal(selectBaseProfile({ profile_path: "/lower.jpg", images: { profiles } }).filePath, "/lower.jpg");
  assert.equal(selectBaseProfile({ profile_path: null, images: { profiles } }).filePath, "/higher.jpg");
  assert.equal(selectBaseProfile({ profile_path: null, images: { profiles: [] } }), null);
});

test("category suggestion remains provisional and uses stable credit evidence", () => {
  const directing = suggestCategoryMembership({
    known_for_department: "Directing",
    combined_credits: { cast: [{ id: 1, media_type: "movie" }], crew: [{ id: 2, media_type: "movie", job: "Director" }] }
  });
  assert.deepEqual(directing.categoryMembership, ["director"]);
  assert.equal(directing.status, "owner-review-required");
  assert.equal(directing.exactDirectorCreditCount, 1);
  const acting = suggestCategoryMembership({ known_for_department: "Acting", combined_credits: { cast: [], crew: [] } });
  assert.deepEqual(acting.categoryMembership, ["actor"]);
});

test("complete and fallback candidates have explicit paired output contracts", () => {
  assert.deepEqual(
    candidateOutputDefinitions({ hasProfile: true, heroStatus: "staging-only-needs-owner-review" })
      .map(([key]) => key),
    ["poster", "landscape", "titleLogo", "focusPoster", "focusLandscape", "hero"]
  );
  assert.deepEqual(
    candidateOutputDefinitions({ hasProfile: false, heroStatus: "skipped" }).map(([key]) => key),
    ["poster", "landscape", "titleLogo"]
  );
});

test("staging emits a non-approved hash-bound review template", () => {
  const template = buildReviewApprovalTemplate({
    personId: 9001,
    canonicalName: "Fixture Person",
    categoryMembership: ["actor"],
    candidateReportSha256: "a".repeat(64),
    heroSelectionSha256: "b".repeat(64)
  });
  assert.equal(template.status, "owner-confirmation-required");
  assert.equal(template.approvals[0].destination, "assets/people/9001");
  assert.equal(template.approvals[0].heroPresetId, "people-t2-perspective-v2");
});

test("new People output paths fail closed outside the ignored intake workspace", () => {
  assert.throws(() => assertNewPersonWorkPath(path.join(repositoryRoot, "assets", "people", "9000001")), /staging output/u);
  assert.doesNotThrow(() => assertNewPersonWorkPath(path.join(repositoryRoot, "tools", "people-intake", ".work", "attempt-fixture")));
});

test("hero preflight accepts an internal staged candidate but the public CLI remains registry-bound", async () => {
  const personCandidate = {
    stableKey: "person:9000001",
    tmdbPersonId: 9000001,
    canonicalName: "Fixture Person",
    categoryMembership: ["actor"]
  };
  const result = await buildPreflight({ personId: 9000001, personCandidate });
  assert.equal(result.identityOrigin, "staged-unregistered-candidate");
  assert.deepEqual(result.person, personCandidate);
  await assert.rejects(() => buildPreflight({ personId: 9000001 }), /not present/u);
});

test("renderer exposes locked monochrome and colour treatments without weakening quality bounds", async () => {
  await assert.rejects(() => renderPeopleArtwork({ people: [], portraitTreatment: "sepia" }), /Unsupported/u);
  await assert.rejects(() => renderPeopleArtwork({ people: [], outputQuality: 0 }), /integer from 1 to 100/u);
});

test("new People Landscape evidence requires the locked chin-safe policy for monochrome and focus", () => {
  const monochrome = landscapeRecord();
  const focus = landscapeRecord({ portraitTreatment: "colour-focus" });
  const evidence = buildNewPersonLandscapePolicyEvidence({
    personId: 9001,
    hasProfile: true,
    monochromeMetadata: renderMetadata(monochrome),
    focusMetadata: renderMetadata(focus)
  });
  assert.equal(evidence.policyId, PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID);
  assert.equal(evidence.monochrome.status, "active-tier-1-slight");
  assert.deepEqual(evidence.monochrome.portraitBounds, { x: 504, y: 0, width: 594, height: 675 });

  assert.throws(() => buildNewPersonLandscapePolicyEvidence({
    personId: 9001,
    hasProfile: true,
    monochromeMetadata: renderMetadata({ ...monochrome, landscapeDefaultCropPolicyId: null }),
    focusMetadata: renderMetadata(focus)
  }), /locked chin-safe policy/u);
  assert.throws(() => buildNewPersonLandscapePolicyEvidence({
    personId: 9001,
    hasProfile: true,
    monochromeMetadata: renderMetadata(monochrome),
    focusMetadata: renderMetadata({ ...focus, portraitBounds: { x: 438, y: 0, width: 660, height: 675 } })
  }), /locked chin-safe placement|differ in chin-safe/u);
});

test("reviewed new People artwork overrides are narrow, source-bound, and proof-bound", async () => {
  const configuration = await loadNewPersonArtworkOverrides({ repositoryRoot });
  assert.equal(configuration.config.recordCount, 7);
  assert.deepEqual(configuration.config.records.map((record) => `${record.tmdbPersonId}/${record.formatId}`), [
    "6729/landscape",
    "55119/landscape",
    "107821/landscape",
    "107821/poster",
    "532227/landscape",
    "544699/landscape",
    "932403/landscape"
  ]);
  const benton = configuration.recordsByKey.get("person:6729/landscape");
  assert.equal(benton.record.sourceProfilePath, "/e8aGltL65lWeWZpwILZWBAieH2C.jpg");
  assert.equal(benton.record.sourceHash,
    "90e39fad06fda1c61162fcfbd4abb6cfd31cd454b4d81c23b94a1f481d50b92d");
  assert.deepEqual(benton.record.cropRectangle, { left: 0, top: 0, width: 682, height: 1023 });
  assert.deepEqual(benton.record.cropScale, { x: 0.659824, y: 0.659824 });
  assert.equal(benton.record.approvedProofs.monochromeWarmSha256,
    "42d809160da250511a0c306b7f81788c5a5b5effdc9bfd4639f928b44dc8fc6d");
  assert.equal(benton.record.approvedProofs.colourFocusSha256,
    "0fe194aa40fa08e275c25f70769409bcfedfaba430019f8cc11d378fd3b25ae6");
  assert.equal(benton.record.trackingIssue, 67);
  const person = {
    stableKey: "person:107821",
    tmdbPersonId: 107821,
    canonicalName: "Ilya Khrzhanovsky"
  };
  const source = {
    available: true,
    sourceHash: "4be8d56880513fb0166edf96c13f5a26adcd49be452af659b3b45180fcd71d27",
    profilePathAttempted: "/93NDSHiogQ03SN6Z57e73Q8qCiy.jpg"
  };
  assert.equal(resolveNewPersonArtworkOverride({
    person,
    source,
    formatId: "poster",
    configuration
  }).record.posterLowerBandStartY, 1260);
  assert.throws(() => resolveNewPersonArtworkOverride({
    person,
    source: { ...source, sourceHash: "f".repeat(64) },
    formatId: "poster",
    configuration
  }), /source-mismatch/u);

  const selected = ["landscape", "poster"].map((formatId) =>
    configuration.recordsByKey.get(`person:107821/${formatId}`));
  const monochrome = renderMetadata(selected.map((item) => reviewedMetadataRecord(item, "monochrome-warm")));
  const focus = renderMetadata(selected.map((item) => reviewedMetadataRecord(item, "colour-focus")));
  const evidence = buildNewPersonArtworkOverrideEvidence({
    personId: 107821,
    monochromeMetadata: monochrome,
    focusMetadata: focus,
    configuration
  });
  assert.deepEqual(evidence.records.map((record) => record.formatId), ["landscape", "poster"]);
  assert.equal(evidence.records[1].monochrome.outputHash,
    "cf5f84f2a516991451349c9a5512b1a071a0274fd3c754c44db7d3313f5c2fb2");
  const changedPoster = monochrome.records.map((record) => record.formatId === "poster"
    ? { ...record, cropRectangle: { ...record.cropRectangle, height: record.cropRectangle.height - 1 } }
    : record);
  assert.throws(() => buildNewPersonArtworkOverrideEvidence({
    personId: 107821,
    monochromeMetadata: renderMetadata(changedPoster),
    focusMetadata: focus,
    configuration
  }), /reviewed override geometry changed/u);
});

test("reviewed full-portrait Landscapes retain chin-safe evidence and paired geometry", async () => {
  const configuration = await loadNewPersonArtworkOverrides({ repositoryRoot });
  const selected = configuration.recordsByKey.get("person:6729/landscape");
  const monochrome = reviewedMetadataRecord(selected, "monochrome-warm");
  const focus = reviewedMetadataRecord(selected, "colour-focus");
  const evidence = buildNewPersonLandscapePolicyEvidence({
    personId: 6729,
    hasProfile: true,
    monochromeMetadata: renderMetadata(monochrome),
    focusMetadata: renderMetadata(focus),
    artworkOverrideConfiguration: configuration
  });
  assert.equal(evidence.monochrome.status, "reviewed-source-bound-override");
  assert.equal(evidence.monochrome.tier, "tier-2-full-portrait");
  assert.deepEqual(evidence.monochrome.portraitBounds, { x: 648, y: 0, width: 450, height: 675 });
  assert.throws(() => buildNewPersonLandscapePolicyEvidence({
    personId: 6729,
    hasProfile: true,
    monochromeMetadata: renderMetadata(monochrome),
    focusMetadata: renderMetadata({ ...focus, portraitBounds: { x: 647, y: 0, width: 450, height: 675 } }),
    artworkOverrideConfiguration: configuration
  }), /geometry changed/u);
});

test("profile-free new People Landscapes bind the chin-safe fallback boundary", () => {
  const evidence = buildNewPersonLandscapePolicyEvidence({
    personId: 9001,
    hasProfile: false,
    monochromeMetadata: renderMetadata(landscapeRecord({ hasProfile: false })),
    focusMetadata: null
  });
  assert.equal(evidence.monochrome.status, "source-unavailable-fallback");
  assert.equal(evidence.focus, null);
});

test("new People intake source contains no credential or permanent publication path", async () => {
  const source = await readFile(path.join(repositoryRoot, "tools", "people-intake", "src", "stage.mjs"), "utf8");
  const overrideSource = await readFile(path.join(repositoryRoot, "tools", "people-intake", "src", "artwork-overrides.mjs"), "utf8");
  const overrideConfiguration = await readFile(path.join(repositoryRoot, "data", "people-intake-artwork-overrides.json"), "utf8");
  assert.doesNotMatch(`${source}\n${overrideSource}\n${overrideConfiguration}`,
    /TMDB_BEARER_TOKEN|api_key|api\.themoviedb\.org/iu);
  assert.doesNotMatch(source, /git\s+(add|commit|push)|npm\s+run\s+manifest/iu);
  assert.match(source, /const workRoot = path\.join\(toolRoot, ["']\.work["']\)/u);
  assert.equal((source.match(/landscapeDefaultCropPolicy:\s*PEOPLE_LANDSCAPE_DEFAULT_CROP_POLICY_ID/gu) || []).length, 2);
});
