#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { buildPreflight, deriveLayoutSeed, isPathInside } from "./preflight.mjs";
import { planPersonHero } from "./selection-policy.mjs";
import { createTmdbProxyClient } from "./tmdb-proxy-client.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(toolRoot, ".work");
const compositorPath = path.join(toolRoot, "vendor", "prism-t2-compositor.py");
const IMAGE_ORIGIN = "https://image.tmdb.org";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = { personId: null, pythonExecutable: process.env.PEOPLE_HERO_PYTHON?.trim() || "python" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--person-id") {
      const value = argv[++index] || "";
      options.personId = /^[1-9]\d*$/u.test(value) ? Number(value) : null;
    }
    else if (argument === "--python") options.pythonExecutable = argv[++index] || null;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return `Usage:
  npm run people-hero:stage -- --person-id <id> [--python <python-executable>]

Requires PEOPLE_HERO_PROXY_URL and, when enabled by the Worker, PEOPLE_HERO_PROXY_TOKEN.
Writes only below tools/people-hero/.work.
`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function allocateAttempt(personId) {
  await mkdir(workRoot, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const attempt = path.join(workRoot, `attempt-${timestamp}-person-${personId}${suffix ? `-${suffix}` : ""}`);
    try {
      await mkdir(attempt);
      assert(isPathInside(workRoot, attempt), "Attempt path escaped the ignored People hero workspace");
      return attempt;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a non-destructive People hero attempt directory");
}

async function runProcess(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export function executableForSpawn(value) {
  assert(typeof value === "string" && value.trim(), "Python executable is required");
  const executable = value.trim();
  const containsPathSeparator = executable.includes("/") || executable.includes("\\");
  return path.isAbsolute(executable) || containsPathSeparator ? path.resolve(executable) : executable;
}

async function downloadOfficialImage(artworkPath, destination, fetchImpl) {
  assert(/^\/[A-Za-z0-9._-]+$/u.test(artworkPath), `Unsafe official artwork path: ${artworkPath}`);
  const url = new URL(`/t/p/original${artworkPath}`, IMAGE_ORIGIN);
  const response = await fetchImpl(url, { headers: { Accept: "image/avif,image/webp,image/jpeg,image/png" } });
  assert(response.ok, `Official artwork download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024, "Official artwork response has an invalid size");
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  assert(metadata.width && metadata.height, "Official artwork could not be decoded");
  await writeFile(destination, bytes);
  return { sha256: sha256(bytes), bytes: bytes.length, width: metadata.width, height: metadata.height };
}

function selectedSourceKeys(selection) {
  if (selection.outcome === "profile-only") return selection.selectedProfiles.map((profile) => `profile:${profile.filePath}`);
  return [
    ...selection.selectedCredits.map((credit) => `${credit.mediaType}:${credit.mediaId}:${credit.posterPath || ""}:${credit.backdropPath || ""}`),
    ...selection.fallbackProfiles.map((profile) => `profile:${profile.filePath}`)
  ];
}

async function prepareSources(selection, sourceDirectory, fetchImpl) {
  await mkdir(sourceDirectory, { recursive: true });
  const planSources = [];
  const downloads = [];
  const add = async ({ id, portraitPath = null, landscapePath = null }, index) => {
    const planSource = { id };
    for (const [kind, artworkPath] of [["portrait", portraitPath], ["landscape", landscapePath]]) {
      if (!artworkPath) continue;
      const filename = `${String(index).padStart(2, "0")}-${kind}${path.extname(artworkPath) || ".img"}`;
      const destination = path.join(sourceDirectory, filename);
      const evidence = await downloadOfficialImage(artworkPath, destination, fetchImpl);
      planSource[kind] = `sources/${filename}`;
      downloads.push({ id, kind, artworkPath, ...evidence });
    }
    planSources.push(planSource);
  };

  if (selection.outcome === "profile-only") {
    for (let index = 0; index < selection.selectedProfiles.length; index += 1) {
      const profile = selection.selectedProfiles[index];
      await add({ id: `profile:${profile.filePath}`, portraitPath: profile.filePath }, index);
    }
  } else {
    for (let index = 0; index < selection.selectedCredits.length; index += 1) {
      const credit = selection.selectedCredits[index];
      await add({ id: `${credit.mediaType}:${credit.mediaId}`, portraitPath: credit.posterPath, landscapePath: credit.backdropPath }, index);
    }
    for (let index = 0; index < selection.fallbackProfiles.length; index += 1) {
      const profile = selection.fallbackProfiles[index];
      await add({ id: `profile:${profile.filePath}`, portraitPath: profile.filePath }, selection.selectedCredits.length + index);
    }
  }
  return { planSources, downloads };
}

export async function stageCandidate({ personId, pythonExecutable, fetchImpl = globalThis.fetch }) {
  assert(pythonExecutable, "--python or PEOPLE_HERO_PYTHON is required");
  const preflight = await buildPreflight({ personId });
  const attemptRoot = await allocateAttempt(personId);
  const reportsDirectory = path.join(attemptRoot, "reports");
  const stagingDirectory = path.join(attemptRoot, "staging");
  await Promise.all([mkdir(reportsDirectory, { recursive: true }), mkdir(stagingDirectory, { recursive: true })]);

  const proxyClient = createTmdbProxyClient({ fetchImpl });
  const snapshot = await proxyClient.getPersonSnapshot(personId);
  const selection = planPersonHero(snapshot, preflight.overrides, {
    minimumCredits: preflight.preset.filmography.minimumCredits,
    maximumCredits: preflight.preset.filmography.maximumCredits,
    minimumProfiles: preflight.preset.profileOnly.minimumProfiles,
    maximumProfiles: preflight.preset.profileOnly.maximumProfiles
  });
  await writeFile(path.join(reportsDirectory, "source-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(path.join(reportsDirectory, "selection.json"), `${JSON.stringify(selection, null, 2)}\n`, "utf8");

  if (selection.outcome === "skip") {
    const report = { version: "nuvio-people-hero-candidate-v2", status: "skipped", person: preflight.person, selection, boundaries: { permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 } };
    await writeFile(path.join(reportsDirectory, "candidate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { attemptRoot, report };
  }

  const { planSources, downloads } = await prepareSources(selection, path.join(attemptRoot, "sources"), fetchImpl);
  const sourceKeys = selectedSourceKeys(selection);
  const seed = deriveLayoutSeed({ presetId: preflight.preset.id, tmdbPersonId: personId, sourceKeys });
  const plan = {
    schemaVersion: 1,
    mode: selection.outcome,
    width: preflight.preset.width,
    height: preflight.preset.height,
    seed,
    accent: [20, 60, 80],
    sources: planSources
  };
  const planPath = path.join(attemptRoot, "compositor-plan.json");
  const intermediatePath = path.join(stagingDirectory, "hero.png");
  const compositorReportPath = path.join(reportsDirectory, "compositor-report.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  const processResult = await runProcess(executableForSpawn(pythonExecutable), [compositorPath, "--plan", planPath, "--output", intermediatePath, "--report", compositorReportPath], toolRoot);
  await writeFile(path.join(reportsDirectory, "compositor.log"), `${processResult.stdout}${processResult.stderr}`, "utf8");
  assert(processResult.code === 0, `T2 compositor exited with code ${processResult.code}`);

  const candidatePath = path.join(stagingDirectory, "hero.webp");
  await sharp(intermediatePath, { failOn: "error" }).webp({ quality: preflight.preset.quality, effort: 6, smartSubsample: true }).toFile(candidatePath);
  const [candidateBytes, candidateStat, metadata, compositorReport] = await Promise.all([
    readFile(candidatePath),
    stat(candidatePath),
    sharp(candidatePath, { failOn: "error" }).metadata(),
    readFile(compositorReportPath, "utf8").then(JSON.parse)
  ]);
  assert(compositorReport.layout?.strategy === "approved-prism-t2-full-bleed-v1", "Compositor did not use the approved full-bleed T2 layout");
  assert(compositorReport.usedSourceCount === planSources.length, "Compositor did not place every unique source");
  assert(compositorReport.visibleEmptySlots === 0, "Compositor left visible card slots empty");
  assert(compositorReport.cropEmptySlots === 0, "Compositor left an unfilled card slot in the perspective crop");
  assert(metadata.format === "webp" && metadata.width === 2560 && metadata.height === 1440, "Candidate output contract mismatch");
  assert(candidateStat.size <= 1024 * 1024, "Candidate exceeds the repository 1 MiB asset ceiling");

  const report = {
    version: "nuvio-people-hero-candidate-v2",
    status: "staging-only-needs-owner-review",
    person: preflight.person,
    preset: preflight.preset,
    seed,
    renderer: preflight.renderer,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, sharp: sharp.versions },
    selection: { outcome: selection.outcome, eligibleCreditCount: selection.eligibleCreditCount, usableProfileCount: selection.usableProfileCount, selectedSourceKeys: sourceKeys },
    requests: { metadata: 1, imageDownloads: downloads.length, downloads },
    compositor: compositorReport,
    output: { path: "staging/hero.webp", sha256: sha256(candidateBytes), bytes: candidateBytes.length, targetBytes: preflight.preset.targetBytes, overTarget: candidateBytes.length > preflight.preset.targetBytes, width: metadata.width, height: metadata.height, format: metadata.format },
    boundaries: { permanentAssetWrites: 0, manifestWrites: 0, publishActions: 0 }
  };
  await writeFile(path.join(reportsDirectory, "candidate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { attemptRoot, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const result = await stageCandidate(options);
      process.stdout.write(`${JSON.stringify({ attemptRoot: result.attemptRoot, ...result.report }, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n\n${usage()}`);
    process.exitCode = 1;
  }
}
