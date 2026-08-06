import assert from "node:assert/strict";
import test from "node:test";

import { planPersonHero, selectEligibleCredits, selectProfiles } from "../src/selection-policy.mjs";

function movie(id, overrides = {}) {
  return {
    id,
    media_type: "movie",
    title: `Movie ${id}`,
    character: "Lead",
    order: 0,
    popularity: 20,
    vote_count: 1000,
    poster_path: `/poster-${id}.jpg`,
    backdrop_path: `/backdrop-${id}.jpg`,
    ...overrides
  };
}

function tv(id, overrides = {}) {
  return {
    id,
    media_type: "tv",
    name: `Series ${id}`,
    character: "Lead",
    episode_count: 8,
    popularity: 20,
    vote_count: 1000,
    poster_path: `/poster-${id}.jpg`,
    backdrop_path: `/backdrop-${id}.jpg`,
    ...overrides
  };
}

function profiles(count) {
  return Array.from({ length: count }, (_, index) => ({
    file_path: `/profile-${index}.jpg`,
    width: 1000,
    height: 1500,
    aspect_ratio: 2 / 3,
    vote_count: count - index,
    vote_average: 5
  }));
}

test("credit policy excludes self, archive, uncredited, own-name, one-episode, adult, and unrelated crew records", () => {
  const person = {
    id: 31,
    name: "Tom Hanks",
    combined_credits: {
      cast: [
        movie(1),
        movie(2, { character: "Self" }),
        movie(3, { character: "Self (archive footage)" }),
        movie(4, { character: "Guest (uncredited)" }),
        movie(5, { character: "Tom Hanks" }),
        tv(6, { episode_count: 1 }),
        movie(7, { adult: true })
      ],
      crew: [
        movie(8, { job: "Producer" }),
        movie(9, { job: "Director" })
      ]
    }
  };
  const result = selectEligibleCredits(person);
  assert.deepEqual(new Set(result.eligible.map((credit) => credit.mediaId)), new Set([1, 9]));
  assert.deepEqual(new Set(result.rejected.map((record) => record.reason)), new Set([
    "self-appearance",
    "uncredited",
    "character-matches-person",
    "one-episode-tv-role",
    "adult",
    "unrelated-crew-job"
  ]));
});

test("one-episode exception is person-specific and cast/director duplicates merge", () => {
  const shared = movie(11, { character: "Lead" });
  const person = {
    id: 31,
    name: "Tom Hanks",
    combined_credits: {
      cast: [tv(10, { episode_count: 1 }), shared],
      crew: [{ ...shared, job: "Director" }]
    }
  };
  const overrides = { oneEpisodeTvRoles: [{ personId: 31, mediaType: "tv", mediaId: 10 }] };
  const result = selectEligibleCredits(person, overrides);
  assert.equal(result.eligible.length, 2);
  assert.deepEqual(result.eligible.find((credit) => credit.mediaId === 11).roles, ["cast", "director"]);
  assert.ok(result.eligible.some((credit) => credit.mediaId === 10));

  const otherPerson = { ...person, id: 32 };
  assert.ok(!selectEligibleCredits(otherPerson, overrides).eligible.some((credit) => credit.mediaId === 10));
});

test("equivalent titles from the same year retain the strongest deterministic credit", () => {
  const person = {
    id: 76594,
    name: "Miley Cyrus",
    combined_credits: {
      cast: [
        movie(53504, {
          title: "Wish Gone Amiss",
          release_date: "2007-07-13",
          character: "Miley Stewart / Hannah Montana",
          popularity: 1.2744,
          vote_count: 11
        }),
        movie(1507919, {
          title: "Wish Gone Amiss",
          release_date: "2007-11-27",
          character: "",
          order: 2,
          popularity: 0.8276,
          vote_count: 1,
          backdrop_path: null
        }),
        movie(99, { title: "Wish Gone Amiss", release_date: "2027-01-01" })
      ],
      crew: []
    }
  };

  const result = selectEligibleCredits(person);
  assert.deepEqual(result.eligible.map((credit) => credit.mediaId), [99, 53504]);
  assert.deepEqual(result.rejected.find((record) => record.mediaId === 1507919), {
    role: "cast",
    mediaType: "movie",
    mediaId: 1507919,
    reason: "equivalent-title-duplicate",
    retainedMediaId: 53504
  });
});

test("profile selection rejects weak shapes and sorts deterministically", () => {
  const selected = selectProfiles({
    images: {
      profiles: [
        ...profiles(2),
        { file_path: "/wide.jpg", width: 1000, height: 600, aspect_ratio: 1.66 },
        { file_path: "/small.jpg", width: 200, height: 300, aspect_ratio: 0.66 },
        { file_path: "/profile-0.jpg", width: 2000, height: 3000, aspect_ratio: 0.66 }
      ]
    }
  });
  assert.deepEqual(selected.map((profile) => profile.filePath), ["/profile-0.jpg", "/profile-1.jpg"]);
});

test("planner chooses filmography, profile-only, and skip without forcing sparse mixtures", () => {
  const filmography = planPersonHero({
    id: 1,
    name: "Person One",
    combined_credits: { cast: Array.from({ length: 18 }, (_, index) => movie(index + 1)), crew: [] },
    images: { profiles: profiles(20) }
  });
  assert.equal(filmography.outcome, "filmography");
  assert.equal(filmography.selectedCredits.length, 18);
  assert.equal(filmography.fallbackProfiles.length, 0);

  const profileOnly = planPersonHero({
    id: 2,
    name: "Person Two",
    combined_credits: { cast: Array.from({ length: 10 }, (_, index) => movie(index + 1)), crew: [] },
    images: { profiles: profiles(17) }
  });
  assert.equal(profileOnly.outcome, "profile-only");
  assert.equal(profileOnly.selectedProfiles.length, 17);

  const skipped = planPersonHero({
    id: 3,
    name: "Person Three",
    combined_credits: { cast: Array.from({ length: 3 }, (_, index) => movie(index + 1)), crew: [] },
    images: { profiles: profiles(4) }
  });
  assert.equal(skipped.outcome, "skip");
});

test("filmography uses up to three profiles only when portrait credit artwork is short", () => {
  const credits = Array.from({ length: 15 }, (_, index) => movie(index + 1, index < 11 ? {} : { poster_path: null }));
  const result = planPersonHero({
    id: 4,
    name: "Person Four",
    combined_credits: { cast: credits, crew: [] },
    images: { profiles: profiles(10) }
  });
  assert.equal(result.outcome, "filmography");
  assert.equal(result.fallbackProfiles.length, 3);
});
