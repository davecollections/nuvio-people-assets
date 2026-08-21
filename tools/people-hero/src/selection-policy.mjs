const SELF_PATTERN = /(?:^|\b)(?:self|himself|herself|themself|themselves)(?:\b|$)/iu;
const ARCHIVE_PATTERN = /\b(?:archive|archival)\b|photograph|photo\s+only/iu;
const UNCREDITED_PATTERN = /uncredited/iu;
const SAFE_ART_PATH = /^\/[A-Za-z0-9._-]+$/u;
const MUSIC_GENRE_ID = 10402;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedIdentity(value) {
  return text(value).normalize("NFKD").replace(/\p{Mark}/gu, "").toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ").trim();
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function integer(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function artworkPath(value) {
  return typeof value === "string" && SAFE_ART_PATH.test(value) ? value : null;
}

function mediaIdentity(record) {
  return `${record.mediaType}:${record.mediaId}`;
}

function titleFor(record) {
  return text(record.title) || text(record.name) || text(record.original_title) || text(record.original_name);
}

function releaseYearFor(record, mediaType) {
  const value = text(mediaType === "movie" ? record.release_date : record.first_air_date);
  const match = /^(\d{4})-/u.exec(value);
  return match ? Number.parseInt(match[1], 10) : null;
}

function oneEpisodeExceptionSet(overrides, personId) {
  const records = Array.isArray(overrides?.oneEpisodeTvRoles) ? overrides.oneEpisodeTvRoles : [];
  return new Set(records.filter((record) => record && record.personId === personId && record.mediaType === "tv" && Number.isSafeInteger(record.mediaId))
    .map((record) => `${personId}:tv:${record.mediaId}`));
}

function blockedMediaSet(overrides, personId) {
  const records = Array.isArray(overrides?.blockedMedia) ? overrides.blockedMedia : [];
  return new Set(records.filter((record) => record
    && (record.personId === undefined || record.personId === personId)
    && (record.mediaType === "movie" || record.mediaType === "tv")
    && Number.isSafeInteger(record.mediaId))
    .map((record) => `${record.mediaType}:${record.mediaId}`));
}

function creativeCrewOverrideMap(overrides, personId) {
  const records = Array.isArray(overrides?.creativeCrewCredits) ? overrides.creativeCrewCredits : [];
  return new Map(records.filter((record) => record
    && record.personId === personId
    && (record.mediaType === "movie" || record.mediaType === "tv")
    && Number.isSafeInteger(record.mediaId)
    && Array.isArray(record.jobs))
    .map((record) => [`${record.mediaType}:${record.mediaId}`, new Set(record.jobs)]));
}

function characterMatchesPerson(character, personName) {
  const normalizedCharacter = normalizedIdentity(character);
  const normalizedPerson = normalizedIdentity(personName);
  return Boolean(normalizedCharacter && normalizedPerson
    && (normalizedCharacter === normalizedPerson || normalizedCharacter.includes(normalizedPerson)));
}

function isPrincipalMusicPerformance(record, personName) {
  const character = text(record?.character);
  const identifiesPerformer = SELF_PATTERN.test(character) || characterMatchesPerson(character, personName);
  return identifiesPerformer
    && record?.media_type === "movie"
    && integer(record?.order, 999) === 0
    && Array.isArray(record?.genre_ids)
    && record.genre_ids.includes(MUSIC_GENRE_ID);
}

function rejectCast(record, personId, personName, exceptions, principalMusicPerformance) {
  const character = text(record.character);
  if (character) {
    if (ARCHIVE_PATTERN.test(character)) return "archive-or-photo-appearance";
    if (UNCREDITED_PATTERN.test(character)) return "uncredited";
    if (SELF_PATTERN.test(character) && !principalMusicPerformance) return "self-appearance";
    if (characterMatchesPerson(character, personName) && !principalMusicPerformance) return "character-matches-person";
  }
  if (record.media_type === "tv" && integer(record.episode_count) <= 1 && !exceptions.has(`${personId}:tv:${record.id}`)) {
    return "one-episode-tv-role";
  }
  return null;
}

function significanceBand(record) {
  if (record.roles.includes("director") && record.roles.includes("cast")) return 6;
  if (record.roles.includes("director")) return 5;
  if (record.roles.includes("creative")) return 4;
  if (record.mediaType === "movie") {
    const billing = Math.max(0, integer(record.billingOrder, 999));
    if (billing <= 2) return 5;
    if (billing <= 7) return 4;
    if (billing <= 14) return 3;
    return 2;
  }
  if (record.episodeCount >= 10) return 5;
  if (record.episodeCount >= 4) return 4;
  return 3;
}

function compareCredits(left, right) {
  return Number(left.principalMusicPerformance) - Number(right.principalMusicPerformance)
    || right.significanceBand - left.significanceBand
    || right.popularityScaled - left.popularityScaled
    || right.voteCount - left.voteCount
    || right.artworkKinds - left.artworkKinds
    || left.mediaType.localeCompare(right.mediaType, "en")
    || left.mediaId - right.mediaId
    || (left.posterPath || "").localeCompare(right.posterPath || "", "en")
    || (left.backdropPath || "").localeCompare(right.backdropPath || "", "en");
}

function normalizeCredit(record, role, { principalMusicPerformance = false } = {}) {
  const mediaType = record?.media_type;
  if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isSafeInteger(record.id) || record.id <= 0) return null;
  const posterPath = artworkPath(record.poster_path);
  const backdropPath = artworkPath(record.backdrop_path);
  return {
    mediaType,
    mediaId: record.id,
    title: titleFor(record),
    releaseYear: releaseYearFor(record, mediaType),
    roles: [role],
    creativeJobs: role === "creative" ? [text(record.job)] : [],
    characters: role === "cast" ? [text(record.character)] : [],
    billingOrder: role === "cast" ? integer(record.order, 999) : 999,
    episodeCount: mediaType === "tv" ? integer(record.episode_count) : 0,
    popularityScaled: Math.round(Math.max(0, finite(record.popularity)) * 1000),
    voteCount: Math.max(0, integer(record.vote_count)),
    posterPath,
    backdropPath,
    artworkKinds: Number(Boolean(posterPath)) + Number(Boolean(backdropPath)),
    principalMusicPerformance: role === "cast" && principalMusicPerformance
  };
}

function mergeCredit(existing, incoming) {
  const roles = [...new Set([...existing.roles, ...incoming.roles])].sort();
  return {
    ...existing,
    roles,
    creativeJobs: [...new Set([...existing.creativeJobs, ...incoming.creativeJobs].filter(Boolean))].sort(),
    characters: [...new Set([...existing.characters, ...incoming.characters].filter(Boolean))].sort(),
    billingOrder: Math.min(existing.billingOrder, incoming.billingOrder),
    episodeCount: Math.max(existing.episodeCount, incoming.episodeCount),
    popularityScaled: Math.max(existing.popularityScaled, incoming.popularityScaled),
    voteCount: Math.max(existing.voteCount, incoming.voteCount),
    posterPath: existing.posterPath || incoming.posterPath,
    backdropPath: existing.backdropPath || incoming.backdropPath,
    artworkKinds: Math.max(existing.artworkKinds, incoming.artworkKinds),
    principalMusicPerformance: existing.principalMusicPerformance || incoming.principalMusicPerformance
  };
}

function equivalentTitleIdentity(record) {
  const normalizedTitle = normalizedIdentity(record.title);
  if (!normalizedTitle || !record.releaseYear) return mediaIdentity(record);
  return `${record.mediaType}:${record.releaseYear}:${normalizedTitle}`;
}

export function selectEligibleCredits(person, overrides = {}) {
  const personName = text(person?.name);
  const credits = person?.combined_credits;
  const exceptions = oneEpisodeExceptionSet(overrides, person?.id);
  const blockedMedia = blockedMediaSet(overrides, person?.id);
  const creativeCrew = creativeCrewOverrideMap(overrides, person?.id);
  const accepted = new Map();
  const rejected = [];

  for (const record of Array.isArray(credits?.cast) ? credits.cast : []) {
    let reason = null;
    const principalMusicPerformance = isPrincipalMusicPerformance(record, personName);
    if (blockedMedia.has(`${record?.media_type}:${record?.id}`)) reason = "blocked-media";
    else if (record?.adult === true) reason = "adult";
    else reason = rejectCast(record, person?.id, personName, exceptions, principalMusicPerformance);
    const normalized = normalizeCredit(record, "cast", { principalMusicPerformance });
    if (!reason && !normalized) reason = "invalid-media-identity";
    if (!reason && !normalized.title) reason = "missing-title";
    if (!reason && normalized.artworkKinds === 0) reason = "missing-artwork";
    if (reason) {
      rejected.push({ role: "cast", mediaType: record?.media_type || null, mediaId: record?.id || null, reason });
      continue;
    }
    const key = mediaIdentity(normalized);
    accepted.set(key, accepted.has(key) ? mergeCredit(accepted.get(key), normalized) : normalized);
  }

  for (const record of Array.isArray(credits?.crew) ? credits.crew : []) {
    let reason = null;
    let role = "director";
    const permittedCreativeJobs = creativeCrew.get(`${record?.media_type}:${record?.id}`);
    if (blockedMedia.has(`${record?.media_type}:${record?.id}`)) reason = "blocked-media";
    else if (record?.adult === true) reason = "adult";
    else if (record?.job === "Director") role = "director";
    else if (permittedCreativeJobs?.has(record?.job)) role = "creative";
    else reason = "unrelated-crew-job";
    const normalized = normalizeCredit(record, role);
    if (!reason && !normalized) reason = "invalid-media-identity";
    if (!reason && !normalized.title) reason = "missing-title";
    if (!reason && normalized.artworkKinds === 0) reason = "missing-artwork";
    if (reason) {
      rejected.push({ role: "crew", mediaType: record?.media_type || null, mediaId: record?.id || null, reason });
      continue;
    }
    const key = mediaIdentity(normalized);
    accepted.set(key, accepted.has(key) ? mergeCredit(accepted.get(key), normalized) : normalized);
  }

  const ranked = [...accepted.values()].map((record) => ({ ...record, significanceBand: significanceBand(record) })).sort(compareCredits);
  const retainedByEquivalentTitle = new Map();
  const eligible = [];
  for (const record of ranked) {
    const key = equivalentTitleIdentity(record);
    const retained = retainedByEquivalentTitle.get(key);
    if (retained) {
      rejected.push({
        role: record.roles.join("+"),
        mediaType: record.mediaType,
        mediaId: record.mediaId,
        reason: "equivalent-title-duplicate",
        retainedMediaId: retained.mediaId
      });
      continue;
    }
    retainedByEquivalentTitle.set(key, record);
    eligible.push(record);
  }
  return { eligible, rejected };
}

export function selectProfiles(person) {
  const profiles = Array.isArray(person?.images?.profiles) ? person.images.profiles : [];
  const unique = new Map();
  for (const profile of profiles) {
    const filePath = artworkPath(profile?.file_path);
    const width = integer(profile?.width);
    const height = integer(profile?.height);
    const aspectRatio = finite(profile?.aspect_ratio, width > 0 && height > 0 ? width / height : 0);
    if (!filePath || width < 300 || height < 450 || aspectRatio < 0.5 || aspectRatio > 0.9) continue;
    if (!unique.has(filePath)) {
      unique.set(filePath, {
        filePath,
        width,
        height,
        voteCount: Math.max(0, integer(profile?.vote_count)),
        voteAverageScaled: Math.round(Math.max(0, finite(profile?.vote_average)) * 1000),
        pixels: width * height
      });
    }
  }
  return [...unique.values()].sort((left, right) => right.voteCount - left.voteCount
    || right.voteAverageScaled - left.voteAverageScaled
    || right.pixels - left.pixels
    || left.filePath.localeCompare(right.filePath, "en"));
}

export function planPersonHero(person, overrides = {}, {
  minimumCredits = 15,
  maximumCredits = 32,
  minimumProfiles = 15,
  maximumProfiles = 24,
  minimumSparseCredits = 1
} = {}) {
  const { eligible, rejected } = selectEligibleCredits(person, overrides);
  const profiles = selectProfiles(person);
  if (eligible.length >= minimumCredits) {
    const selectedCredits = eligible.slice(0, maximumCredits);
    const portraitCreditCount = selectedCredits.filter((credit) => credit.posterPath).length;
    const fallbackProfileCount = Math.min(3, Math.max(0, minimumCredits - portraitCreditCount), profiles.length);
    return {
      outcome: "filmography",
      selectedCredits,
      fallbackProfiles: profiles.slice(0, fallbackProfileCount),
      eligibleCreditCount: eligible.length,
      usableProfileCount: profiles.length,
      rejected
    };
  }
  if (profiles.length >= minimumProfiles) {
    return {
      outcome: "profile-only",
      selectedProfiles: profiles.slice(0, maximumProfiles),
      eligibleCreditCount: eligible.length,
      usableProfileCount: profiles.length,
      rejected
    };
  }
  if (eligible.length >= minimumSparseCredits) {
    return {
      outcome: "sparse-fallback",
      selectedCredits: eligible,
      fallbackProfiles: [],
      eligibleCreditCount: eligible.length,
      usableProfileCount: profiles.length,
      rejected
    };
  }
  return {
    outcome: "skip",
    reason: "no-eligible-credit-artwork-and-insufficient-profiles",
    eligibleCreditCount: eligible.length,
    usableProfileCount: profiles.length,
    rejected
  };
}
