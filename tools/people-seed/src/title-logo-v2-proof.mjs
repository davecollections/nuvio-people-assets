#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { prepareTitleLogoV2Renderer, renderTitleLogoV2 } from "./people-artwork/title-logo-v2.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const workRoot = path.join(packageRoot, ".work", "title-logo-v2-proof");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content);
  await fs.rename(temporaryPath, filePath);
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseTitleLogoV2ProofArguments(argv) {
  const options = { personIds: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--person-id") {
      const raw = takeValue(argv, index, argument);
      index += 1;
      for (const value of raw.split(/[\s,]+/u).filter(Boolean)) {
        if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`Invalid TMDB Person ID: ${value}`);
        options.personIds.push(Number(value));
      }
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown People title-logo v2 proof argument: ${argument}`);
    }
  }
  if (options.help) return options;
  assert(options.personIds.length >= 1 && options.personIds.length <= 12, "Select between 1 and 12 explicit TMDB Person IDs.");
  assert(new Set(options.personIds).size === options.personIds.length, "Duplicate TMDB Person IDs are not allowed.");
  return { personIds: [...options.personIds].sort((left, right) => left - right), help: false };
}

function timestampId(now) {
  return now.toISOString().replace(/[-:.]/gu, "");
}

function attemptName(personIds, now) {
  const selectionHash = sha256(Buffer.from(personIds.join(","), "utf8")).slice(0, 12);
  return `attempt-${timestampId(now)}-title-logo-v2-${personIds.length}-${selectionHash}`;
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelSvg({ width, height, text, fontSize = 30, align = "left" }) {
  const x = align === "center" ? width / 2 : 40;
  const anchor = align === "center" ? "middle" : "start";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${x}" y="${fontSize + 10}" fill="#aeb8c8" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="600" text-anchor="${anchor}">${escapeXml(text)}</text></svg>`);
}

async function containedLogo(runtime, buffer, width, height) {
  return runtime.sharp(buffer).resize({ width, height, fit: "inside", withoutEnlargement: false }).png().toBuffer();
}

async function renderReviewSheet({ runtime, rendered }) {
  const columns = 2;
  const panelWidth = 1200;
  const panelHeight = 440;
  const rows = Math.ceil(rendered.length / columns);
  const overlays = [];
  for (const [index, item] of rendered.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * panelWidth;
    const top = row * panelHeight;
    const logo = await containedLogo(runtime, item.output, 1000, 285);
    const logoMetadata = await runtime.sharp(logo).metadata();
    overlays.push({ input: logo, left: left + Math.round((panelWidth - logoMetadata.width) / 2), top: top + 76 + Math.round((285 - logoMetadata.height) / 2) });
    overlays.push({ input: labelSvg({ width: panelWidth, height: 60, text: `${item.record.canonicalName} · TMDB ${item.record.tmdbPersonId}`, align: "center" }), left, top: top + 18 });
    if (column > 0) overlays.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${panelHeight}"><rect width="1" height="${panelHeight}" fill="#253044"/></svg>`), left, top });
    if (row > 0 && column === 0) overlays.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${columns * panelWidth}" height="1"><rect width="${columns * panelWidth}" height="1" fill="#253044"/></svg>`), left: 0, top });
  }
  return runtime.sharp({ create: { width: columns * panelWidth, height: rows * panelHeight, channels: 4, background: "#0b111b" } })
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function renderTomComparison({ runtime, candidate }) {
  const currentPath = path.join(repoRoot, "assets", "people", "31", "title-logo.png");
  const current = await fs.readFile(currentPath);
  const panelWidth = 1200;
  const panelHeight = 560;
  const currentLogo = await containedLogo(runtime, current, 920, 330);
  const candidateLogo = await containedLogo(runtime, candidate.output, 920, 330);
  const currentMetadata = await runtime.sharp(currentLogo).metadata();
  const candidateMetadata = await runtime.sharp(candidateLogo).metadata();
  const divider = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${panelHeight}"><rect width="1" height="${panelHeight}" fill="#253044"/></svg>`);
  return runtime.sharp({ create: { width: panelWidth * 2, height: panelHeight, channels: 4, background: "#0b111b" } })
    .composite([
      { input: labelSvg({ width: panelWidth, height: 70, text: "APPROVED TIGHT V1 · TOM HANKS", align: "center" }), left: 0, top: 25 },
      { input: labelSvg({ width: panelWidth, height: 70, text: "V2 DESIGN LOCK · TOM HANKS", align: "center" }), left: panelWidth, top: 25 },
      { input: currentLogo, left: Math.round((panelWidth - currentMetadata.width) / 2), top: 130 + Math.round((330 - currentMetadata.height) / 2) },
      { input: candidateLogo, left: panelWidth + Math.round((panelWidth - candidateMetadata.width) / 2), top: 130 + Math.round((330 - candidateMetadata.height) / 2) },
      { input: divider, left: panelWidth, top: 0 },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

export async function stageTitleLogoV2Proof({ personIds, now = new Date() } = {}) {
  ({ personIds } = parseTitleLogoV2ProofArguments(personIds.flatMap((personId) => ["--person-id", String(personId)])));
  const registry = JSON.parse(await fs.readFile(path.join(repoRoot, "data", "people-base", "people-registry.json"), "utf8"));
  const registryById = new Map(registry.records.map((record) => [record.tmdbPersonId, record]));
  const people = personIds.map((personId) => {
    const person = registryById.get(personId);
    assert(person, `${personId}: TMDB Person ID is not present in the People registry.`);
    return {
      stableKey: person.stableKey,
      tmdbPersonId: person.tmdbPersonId,
      canonicalName: person.canonicalName,
      categoryMembership: [...person.categoryMembership],
    };
  });
  const outputDir = path.join(workRoot, attemptName(personIds, now));
  const relative = path.relative(repoRoot, outputDir).replaceAll("\\", "/");
  assert(relative.startsWith("tools/people-seed/.work/title-logo-v2-proof/"), `People title-logo v2 proof output escaped the ignored workspace: ${outputDir}`);
  await fs.mkdir(workRoot, { recursive: true });
  await fs.mkdir(outputDir, { recursive: false });
  const prepared = await prepareTitleLogoV2Renderer({ people });
  const rendered = [];
  for (const person of people) {
    const result = await renderTitleLogoV2({ person, ...prepared });
    await atomicWrite(path.join(outputDir, "individual", `${person.tmdbPersonId}.png`), result.output);
    rendered.push(result);
  }
  const reviewSheet = await renderReviewSheet({ runtime: prepared.runtime, rendered });
  await atomicWrite(path.join(outputDir, "review-sheet.png"), reviewSheet);
  const tom = rendered.find((item) => item.record.tmdbPersonId === 31);
  let comparisonPath = null;
  if (tom) {
    const comparison = await renderTomComparison({ runtime: prepared.runtime, candidate: tom });
    comparisonPath = path.join(outputDir, "tom-hanks-v1-v2-comparison.png");
    await atomicWrite(comparisonPath, comparison);
  }
  const report = {
    version: "people-title-logo-standard-canvas-proof-report-v1",
    generatedAt: now.toISOString(),
    stagingOnly: true,
    publicationAuthorised: false,
    networkRequests: 0,
    downloads: 0,
    personIds,
    recordCount: rendered.length,
    records: rendered.map((item) => item.record),
  };
  const reportPath = path.join(outputDir, "proof-report.json");
  await atomicWrite(reportPath, Buffer.from(`${JSON.stringify(report, null, 2)}\n`));
  return { outputDir, reportPath, reviewSheetPath: path.join(outputDir, "review-sheet.png"), comparisonPath, report };
}

export const TITLE_LOGO_V2_PROOF_HELP = `Stage a People title-logo standard-canvas v2 proof\n\n  --person-id <id[,id...]>   Required; 1-12 registered IDs\n\nThe command makes no network requests and writes only beneath tools/people-seed/.work/title-logo-v2-proof.\n`;

async function main() {
  const options = parseTitleLogoV2ProofArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(TITLE_LOGO_V2_PROOF_HELP);
    return;
  }
  const result = await stageTitleLogoV2Proof(options);
  process.stdout.write(`${JSON.stringify({ valid: true, outputDir: result.outputDir, reportPath: result.reportPath, reviewSheetPath: result.reviewSheetPath, comparisonPath: result.comparisonPath, personIds: options.personIds, networkRequests: 0, downloads: 0 }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
