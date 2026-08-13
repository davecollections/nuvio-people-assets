#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { isPathInside } from "../../people-hero/src/preflight.mjs";
import { downloadOfficialImage, stageCandidate as stageHeroCandidate } from "../../people-hero/src/stage.mjs";
import { createTmdbProxyClient } from "../../people-hero/src/tmdb-proxy-client.mjs";
import { writeRenderMetadata } from "../../people-seed/src/people-artwork/metadata.mjs";
import {
  PEOPLE_ARTWORK_RENDERER_VERSION,
  renderPeopleArtwork
} from "../../people-seed/src/people-artwork/renderer.mjs";
import { prepareTitleLogoV2Renderer, renderTitleLogoV2 } from "../../people-seed/src/people-artwork/title-logo-v2.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(toolRoot, "../..");
const workRoot = path.join(toolRoot, ".work");
const PROFILE_PATH = /^\/[A-Za-z0-9._-]+\.jpg$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(filePath, content);
  return { path: path.relative(repositoryRoot, filePath).replaceAll("\\", "/"), sha256: sha256(content), bytes: content.length };
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseNewPersonStageArguments(argv) {
  const options = {
    personId: null,
    pythonExecutable: process.env.PEOPLE_HERO_PYTHON?.trim() || "python",
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--person-id") {
      const raw = takeValue(argv, index, argument);
      index += 1;
      if (!/^[1-9]\d*$/u.test(raw)) throw new Error(`Invalid TMDB Person ID: ${raw}`);
      options.personId = Number(raw);
    } else if (argument === "--python") {
      options.pythonExecutable = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown new People staging argument: ${argument}`);
    }
  }
  if (!options.help) {
    assert(Number.isSafeInteger(options.personId) && options.personId > 0,
      "Select exactly one positive TMDB Person ID");
    assert(typeof options.pythonExecutable === "string" && options.pythonExecutable.trim(),
      "A Python executable is required");
  }
  return options;
}

export function selectBaseProfile(snapshot) {
  const profiles = Array.isArray(snapshot?.images?.profiles) ? snapshot.images.profiles : [];
  const byPath = new Map(profiles
    .filter((profile) => profile && PROFILE_PATH.test(profile.file_path || ""))
    .map((profile) => [profile.file_path, profile]));
  if (PROFILE_PATH.test(snapshot?.profile_path || "")) {
    const profile = byPath.get(snapshot.profile_path) || {};
    return {
      filePath: snapshot.profile_path,
      width: Number.isInteger(profile.width) ? profile.width : null,
      height: Number.isInteger(profile.height) ? profile.height : null,
      voteAverage: Number.isFinite(profile.vote_average) ? profile.vote_average : null,
      voteCount: Number.isInteger(profile.vote_count) ? profile.vote_count : null,
      selectionReason: "tmdb-default-profile"
    };
  }
  const eligible = profiles.filter((profile) => profile
    && PROFILE_PATH.test(profile.file_path || "")
    && Number.isInteger(profile.width)
    && Number.isInteger(profile.height)
    && profile.width > 0
    && profile.height > profile.width);
  eligible.sort((left, right) =>
    (right.vote_count || 0) - (left.vote_count || 0)
    || (right.vote_average || 0) - (left.vote_average || 0)
    || right.width * right.height - left.width * left.height
    || left.file_path.localeCompare(right.file_path));
  const profile = eligible[0];
  return profile ? {
    filePath: profile.file_path,
    width: profile.width,
    height: profile.height,
    voteAverage: Number.isFinite(profile.vote_average) ? profile.vote_average : null,
    voteCount: Number.isInteger(profile.vote_count) ? profile.vote_count : null,
    selectionReason: "deterministic-official-profile-fallback"
  } : null;
}

export function suggestCategoryMembership(snapshot) {
  const crew = Array.isArray(snapshot?.combined_credits?.crew) ? snapshot.combined_credits.crew : [];
  const cast = Array.isArray(snapshot?.combined_credits?.cast) ? snapshot.combined_credits.cast : [];
  const exactDirectorCredits = new Set(crew
    .filter((credit) => credit?.job === "Director" && Number.isSafeInteger(credit.id))
    .map((credit) => `${credit.media_type || "unknown"}:${credit.id}`)).size;
  const actingCredits = new Set(cast
    .filter((credit) => Number.isSafeInteger(credit?.id))
    .map((credit) => `${credit.media_type || "unknown"}:${credit.id}`)).size;
  const knownForDepartment = typeof snapshot?.known_for_department === "string"
    ? snapshot.known_for_department.trim()
    : "";
  const categoryMembership = knownForDepartment === "Directing"
    || (!knownForDepartment && exactDirectorCredits > 0 && actingCredits === 0)
    ? ["director"]
    : ["actor"];
  return {
    categoryMembership,
    status: "owner-review-required",
    basis: knownForDepartment ? "tmdb-known-for-department" : "combined-credit-fallback",
    knownForDepartment: knownForDepartment || null,
    actingCreditCount: actingCredits,
    exactDirectorCreditCount: exactDirectorCredits
  };
}

export function assertNewPersonWorkPath(targetPath) {
  const resolved = path.resolve(targetPath);
  assert(isPathInside(workRoot, resolved) && resolved !== workRoot,
    `New People staging output must stay below tools/people-intake/.work: ${resolved}`);
  return resolved;
}

export function candidateOutputDefinitions({ hasProfile, heroStatus }) {
  const definitions = [
    ["poster", "poster.webp", { format: "webp", width: 1000, height: 1500 }],
    ["landscape", "landscape.webp", { format: "webp", width: 1200, height: 675 }],
    ["titleLogo", "title-logo.png", { format: "png", width: 1600, height: 480 }]
  ];
  if (hasProfile) definitions.push(
    ["focusPoster", "focus-poster.webp", { format: "webp", width: 1000, height: 1500 }],
    ["focusLandscape", "focus-landscape.webp", { format: "webp", width: 1200, height: 675 }]
  );
  if (heroStatus !== "skipped") definitions.push(
    ["hero", "hero.webp", { format: "webp", width: 2560, height: 1440 }]
  );
  return definitions;
}

async function allocateAttempt(personId, now) {
  await mkdir(workRoot, { recursive: true });
  const timestamp = now.toISOString().replaceAll(/[-:.]/gu, "");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const attemptRoot = path.join(workRoot, `attempt-${timestamp}-new-person-${personId}${suffix ? `-${suffix}` : ""}`);
    assertNewPersonWorkPath(attemptRoot);
    try {
      await mkdir(attemptRoot, { recursive: false });
      return attemptRoot;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a non-destructive new People attempt directory");
}

async function ensureUnregistered(personId) {
  const registry = JSON.parse(await readFile(path.join(repositoryRoot, "data", "people.json"), "utf8"));
  assert(Array.isArray(registry.people), "Canonical People registry is invalid");
  assert(!registry.people.some((person) => person.tmdbPersonId === personId),
    `TMDB Person ID ${personId} is already registered; use the refresh workflow instead`);
}

async function inspectOutput(filePath, expected) {
  const bytes = await readFile(filePath);
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  assert(metadata.format === expected.format, `${filePath}: expected ${expected.format} output`);
  assert(metadata.width === expected.width && metadata.height === expected.height,
    `${filePath}: expected ${expected.width}x${expected.height} output`);
  assert(bytes.length < 1024 * 1024, `${filePath}: output exceeds the repository 1 MiB ceiling`);
  return {
    path: path.relative(repositoryRoot, filePath).replaceAll("\\", "/"),
    sha256: sha256(bytes),
    bytes: bytes.length,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format
  };
}

async function copyCandidate(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function stageNewPerson({
  personId,
  pythonExecutable = process.env.PEOPLE_HERO_PYTHON?.trim() || "python",
  fetchImpl = globalThis.fetch,
  now = new Date(),
  proxyClient = null,
  heroStageImpl = stageHeroCandidate
} = {}) {
  assert(Number.isSafeInteger(personId) && personId > 0, "personId must be a positive safe integer");
  assert(typeof pythonExecutable === "string" && pythonExecutable.trim(), "A Python executable is required");
  await ensureUnregistered(personId);
  const attemptRoot = await allocateAttempt(personId, now);
  const reportsRoot = path.join(attemptRoot, "reports");
  const candidateIdentityRoot = path.join(attemptRoot, "candidate", "assets", "people", String(personId));
  await Promise.all([mkdir(reportsRoot, { recursive: true }), mkdir(candidateIdentityRoot, { recursive: true })]);

  const client = proxyClient || createTmdbProxyClient({ fetchImpl });
  const snapshot = await client.getPersonSnapshot(personId);
  assert(snapshot?.id === personId, "People proxy returned the wrong identity");
  assert(typeof snapshot.name === "string" && snapshot.name.trim(), "People proxy returned an identity without a name");
  const sourceSnapshot = await writeJson(path.join(reportsRoot, "source-snapshot.json"), snapshot);

  const categorySuggestion = suggestCategoryMembership(snapshot);
  const selectedProfile = selectBaseProfile(snapshot);
  const person = {
    stableKey: `person:${personId}`,
    tmdbPersonId: personId,
    canonicalName: snapshot.name.trim(),
    profilePath: selectedProfile?.filePath || null,
    categoryMembership: [...categorySuggestion.categoryMembership]
  };
  const registrationCandidate = {
    version: "nuvio-new-person-registration-candidate-v1",
    status: "owner-review-required",
    tmdbPersonId: personId,
    canonicalName: person.canonicalName,
    stableKey: person.stableKey,
    suggestedCategoryMembership: [...categorySuggestion.categoryMembership],
    categorySuggestion
  };
  await writeJson(path.join(reportsRoot, "registration-candidate.json"), registrationCandidate);

  const sourceCacheRoot = path.join(attemptRoot, "portrait-source");
  await mkdir(sourceCacheRoot, { recursive: true });
  let profileDownload = null;
  const sourceEntries = [];
  if (selectedProfile) {
    const sourceFileName = `person-${personId}${path.extname(selectedProfile.filePath) || ".jpg"}`;
    const sourceFile = path.join(sourceCacheRoot, sourceFileName);
    profileDownload = await downloadOfficialImage(selectedProfile.filePath, sourceFile, fetchImpl);
    assert(profileDownload.height > profileDownload.width, "Selected TMDB profile source is not portrait-oriented");
    sourceEntries.push({
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      profilePath: selectedProfile.filePath,
      sourceFile: sourceFileName,
      sourceHash: profileDownload.sha256,
      width: profileDownload.width,
      height: profileDownload.height,
      exifOrientation: 1
    });
  }
  await writeJson(path.join(sourceCacheRoot, "index.json"), {
    version: "people-portrait-source-cache-v1",
    ordering: "stable-key-then-profile-path",
    entries: sourceEntries
  });

  const decisions = { version: "new-people-empty-portrait-decisions-v1", records: [] };
  const monochromeRoot = path.join(attemptRoot, "renders", "monochrome");
  const monochrome = await renderPeopleArtwork({
    people: [person],
    decisions,
    sourceCache: sourceCacheRoot,
    outputDir: monochromeRoot,
    format: "both",
    portraitTreatment: "monochrome-warm"
  });
  await writeRenderMetadata({
    metadata: monochrome.metadata,
    outputDir: reportsRoot,
    jsonName: "monochrome-render-metadata.json",
    csvName: "monochrome-render-metadata.csv"
  });
  await copyCandidate(path.join(monochromeRoot, "poster", `${personId}.webp`), path.join(candidateIdentityRoot, "poster.webp"));
  await copyCandidate(path.join(monochromeRoot, "landscape", `${personId}.webp`), path.join(candidateIdentityRoot, "landscape.webp"));

  let focus = null;
  if (selectedProfile) {
    const focusRoot = path.join(attemptRoot, "renders", "focus");
    focus = await renderPeopleArtwork({
      people: [person],
      decisions,
      sourceCache: sourceCacheRoot,
      outputDir: focusRoot,
      format: "both",
      portraitTreatment: "colour-focus",
      outputQuality: 82
    });
    assert(focus.resolutions[0]?.sourceStatus === "validated-cache-hit",
      "Focus artwork requires a validated portrait source");
    await writeRenderMetadata({
      metadata: focus.metadata,
      outputDir: reportsRoot,
      jsonName: "focus-render-metadata.json",
      csvName: "focus-render-metadata.csv"
    });
    await copyCandidate(path.join(focusRoot, "poster", `${personId}.webp`), path.join(candidateIdentityRoot, "focus-poster.webp"));
    await copyCandidate(path.join(focusRoot, "landscape", `${personId}.webp`), path.join(candidateIdentityRoot, "focus-landscape.webp"));
  }

  const preparedTitle = await prepareTitleLogoV2Renderer({ people: [person] });
  const titleLogo = await renderTitleLogoV2({ person, ...preparedTitle });
  await writeFile(path.join(candidateIdentityRoot, "title-logo.png"), titleLogo.output);
  await writeJson(path.join(reportsRoot, "title-logo-metadata.json"), titleLogo.record);

  const hero = await heroStageImpl({
    personId,
    pythonExecutable,
    fetchImpl,
    sourceSnapshot: snapshot,
    personCandidate: person,
    attemptRoot: path.join(attemptRoot, "hero")
  });
  if (hero.report.status !== "skipped") {
    await copyCandidate(path.join(hero.attemptRoot, "staging", "hero.webp"), path.join(candidateIdentityRoot, "hero.webp"));
  }

  const outputDefinitions = candidateOutputDefinitions({
    hasProfile: Boolean(selectedProfile),
    heroStatus: hero.report.status
  });
  const outputs = {};
  for (const [key, fileName, expected] of outputDefinitions) {
    outputs[key] = await inspectOutput(path.join(candidateIdentityRoot, fileName), expected);
  }

  const report = {
    version: "nuvio-new-person-artwork-candidate-v1",
    status: "staging-only-needs-owner-review",
    generatedAt: now.toISOString(),
    trackingIssue: 45,
    person: registrationCandidate,
    sourceSnapshot,
    profileSource: selectedProfile ? { ...selectedProfile, ...profileDownload } : {
      selectionReason: "no-usable-official-profile",
      filePath: null
    },
    renderers: {
      monochrome: {
        version: PEOPLE_ARTWORK_RENDERER_VERSION,
        treatment: "monochrome-warm",
        quality: monochrome.metadata.records[0]?.outputQuality || null,
        presetIds: [...new Set(monochrome.metadata.records.map((record) => record.presetId))],
        presetHashes: [...new Set(monochrome.metadata.records.map((record) => record.presetHash))]
      },
      focus: focus ? {
        version: PEOPLE_ARTWORK_RENDERER_VERSION,
        treatment: "colour-focus",
        quality: focus.metadata.records[0]?.outputQuality || null,
        presetIds: [...new Set(focus.metadata.records.map((record) => record.presetId))],
        presetHashes: [...new Set(focus.metadata.records.map((record) => record.presetHash))]
      } : null,
      titleLogo: {
        version: titleLogo.record.rendererVersion,
        presetId: titleLogo.record.presetId,
        presetHash: titleLogo.record.presetHash,
        fontHash: titleLogo.record.fontHash
      },
      hero: hero.report.renderer || null
    },
    hero: {
      status: hero.report.status,
      outcome: hero.report.selection?.outcome || null,
      output: hero.report.output || null
    },
    requests: {
      metadata: 1,
      profileImageDownloads: selectedProfile ? 1 : 0,
      heroImageDownloads: hero.report.requests?.imageDownloads || 0,
      totalImageDownloads: (selectedProfile ? 1 : 0) + (hero.report.requests?.imageDownloads || 0)
    },
    outputs,
    boundaries: {
      permanentAssetWrites: 0,
      registryWrites: 0,
      manifestWrites: 0,
      gitActions: 0,
      publishActions: 0
    }
  };
  const reportPath = path.join(reportsRoot, "candidate-report.json");
  await writeJson(reportPath, report);
  return { attemptRoot, candidateIdentityRoot, reportPath, report, monochrome, focus, hero };
}

export const NEW_PERSON_STAGE_HELP = `Stage a complete artwork set for one unregistered TMDB Person ID\n\n  --person-id <id>       Required; exactly one unregistered ID\n  --python <executable>  Optional; defaults to PEOPLE_HERO_PYTHON or python\n\nRequires PEOPLE_HERO_PROXY_URL and, when enabled, PEOPLE_HERO_PROXY_TOKEN.\nWrites only below tools/people-intake/.work and never publishes assets.\n`;

async function main() {
  const options = parseNewPersonStageArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(NEW_PERSON_STAGE_HELP);
    return;
  }
  const result = await stageNewPerson(options);
  process.stdout.write(`${JSON.stringify({
    valid: true,
    attemptRoot: result.attemptRoot,
    candidateIdentityRoot: result.candidateIdentityRoot,
    reportPath: result.reportPath,
    personId: options.personId,
    status: result.report.status,
    requests: result.report.requests,
    boundaries: result.report.boundaries
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n\n${NEW_PERSON_STAGE_HELP}`);
    process.exitCode = 1;
  });
}
