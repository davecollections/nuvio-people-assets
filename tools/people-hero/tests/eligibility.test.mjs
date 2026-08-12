import assert from "node:assert/strict";
import test from "node:test";

import { buildEligibilityReport, checkEligibility } from "../src/eligibility.mjs";

const person = { tmdbPersonId: 2230991, canonicalName: "Daisy Edgar-Jones" };
const preset = {
  id: "people-t2-perspective-v2",
  filmography: { minimumCredits: 15, maximumCredits: 32 },
  profileOnly: { minimumProfiles: 15, maximumProfiles: 24 },
  sparseFallback: { minimumCredits: 1 }
};

test("eligibility report is compact, deterministic, and records no generation work", () => {
  const selection = {
    outcome: "profile-only",
    selectedProfiles: Array.from({ length: 22 }, (_, index) => ({ filePath: `/profile-${index}.jpg` })),
    eligibleCreditCount: 12,
    usableProfileCount: 22,
    rejected: [
      { reason: "self-appearance", mediaId: 1 },
      { reason: "one-episode-tv-role", mediaId: 2 },
      { reason: "self-appearance", mediaId: 3 }
    ]
  };

  const report = buildEligibilityReport({ person, preset, selection });
  assert.deepEqual(report.selection, {
    outcome: "profile-only",
    reason: null,
    eligibleCreditCount: 12,
    usableProfileCount: 22,
    selectedCreditCount: 0,
    selectedProfileCount: 22,
    fallbackProfileCount: 0,
    rejectionReasonCounts: [
      { reason: "one-episode-tv-role", count: 1 },
      { reason: "self-appearance", count: 2 }
    ]
  });
  assert.deepEqual(report.requests, { metadata: 1, imageDownloads: 0 });
  assert.deepEqual(report.boundaries, { generatedAssets: 0, permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 });

  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("/profile-"));
  assert.ok(!serialized.includes("character"));
  assert.equal(serialized, JSON.stringify(buildEligibilityReport({ person, preset, selection })));
});

test("eligibility report summarizes filmography, sparse fallback, and skip outcomes", () => {
  const filmography = buildEligibilityReport({
    person,
    preset,
    selection: {
      outcome: "filmography",
      selectedCredits: Array.from({ length: 17 }, () => ({})),
      fallbackProfiles: [{}, {}],
      eligibleCreditCount: 17,
      usableProfileCount: 20,
      rejected: []
    }
  });
  assert.equal(filmography.selection.selectedCreditCount, 17);
  assert.equal(filmography.selection.fallbackProfileCount, 2);

  const sparse = buildEligibilityReport({
    person,
    preset,
    selection: {
      outcome: "sparse-fallback",
      selectedCredits: Array.from({ length: 8 }, () => ({})),
      fallbackProfiles: [],
      eligibleCreditCount: 8,
      usableProfileCount: 3,
      rejected: []
    }
  });
  assert.equal(sparse.selection.selectedCreditCount, 8);
  assert.equal(sparse.selection.fallbackProfileCount, 0);

  const skipped = buildEligibilityReport({
    person,
    preset,
    selection: {
      outcome: "skip",
      reason: "no-eligible-credit-artwork-and-insufficient-profiles",
      eligibleCreditCount: 0,
      usableProfileCount: 3,
      rejected: []
    }
  });
  assert.equal(skipped.selection.reason, "no-eligible-credit-artwork-and-insufficient-profiles");
  assert.equal(skipped.selection.selectedCreditCount, 0);
  assert.equal(skipped.selection.selectedProfileCount, 0);
});

test("eligibility check makes one metadata request and can retain only the compact result", async () => {
  let metadataRequests = 0;
  let retainedReport = null;
  const snapshot = {
    id: 2230991,
    name: "Daisy Edgar-Jones",
    combined_credits: {
      cast: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        media_type: "movie",
        title: `Movie ${index + 1}`,
        character: "Lead",
        order: 0,
        popularity: 20,
        vote_count: 1000,
        poster_path: `/poster-${index + 1}.jpg`,
        backdrop_path: `/backdrop-${index + 1}.jpg`
      })),
      crew: []
    },
    images: {
      profiles: Array.from({ length: 22 }, (_, index) => ({
        file_path: `/profile-${index}.jpg`,
        width: 1000,
        height: 1500,
        aspect_ratio: 2 / 3,
        vote_count: 22 - index,
        vote_average: 5
      }))
    }
  };

  const result = await checkEligibility({
    personId: 2230991,
    proxyClient: {
      async getPersonSnapshot(personId) {
        metadataRequests += 1;
        assert.equal(personId, 2230991);
        return snapshot;
      }
    },
    async resultWriter({ personId, report }) {
      assert.equal(personId, 2230991);
      retainedReport = report;
      return "memory:eligibility-result";
    }
  });

  assert.equal(metadataRequests, 1);
  assert.equal(result.attemptRoot, "memory:eligibility-result");
  assert.equal(result.report, retainedReport);
  assert.equal(result.report.selection.outcome, "profile-only");
  assert.equal(result.report.selection.eligibleCreditCount, 12);
  assert.equal(result.report.selection.usableProfileCount, 22);
  assert.deepEqual(result.report.requests, { metadata: 1, imageDownloads: 0 });
  assert.equal(JSON.stringify(result.report).includes("/profile-"), false);
});
