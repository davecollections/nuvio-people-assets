import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const PROFILE_PATH = /^\/[A-Za-z0-9_-]+\.jpg$/u;

export const FALLBACK_REASONS = Object.freeze([
  "no-profile-path",
  "source-not-cached",
  "source-empty",
  "source-decode-failed",
  "source-dimensions-invalid",
  "source-validation-failed",
]);

export class SourceFailure extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "SourceFailure";
    this.reason = reason;
    this.details = details;
  }
}

export function resolveApprovedProfile(person, decisions) {
  const decision = decisions.records.find((item) => item.stableKey === person.stableKey) || null;
  if (decision) {
    if (decision.tmdbPersonId !== person.tmdbPersonId || decision.canonicalName !== person.canonicalName) {
      throw new SourceFailure("source-validation-failed", `${person.stableKey}: portrait decision identity binding drifted.`);
    }
    if (decision.registryProfilePath !== person.profilePath) {
      throw new SourceFailure("source-validation-failed", `${person.stableKey}: registry profile path no longer matches the approved decision.`);
    }
  }
  const profilePath = decision?.decision === "use-owner-selected"
    ? decision.approvedProfilePath
    : person.profilePath;
  return {
    profilePath,
    sourceDecision: decision?.decision || "registry-default",
    decision,
  };
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function readSourceCacheIndex(sourceCache) {
  const indexPath = path.join(path.resolve(sourceCache), "index.json");
  if (!(await exists(indexPath))) return { version: "people-portrait-source-cache-v1", ordering: "stable-key-then-profile-path", entries: [] };
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  if (index.version !== "people-portrait-source-cache-v1" || !Array.isArray(index.entries)) {
    throw new SourceFailure("source-validation-failed", `Invalid source cache index: ${indexPath}`);
  }
  return index;
}

export function selectSourceCacheCandidates(entries, { stableKey, profilePath, expectedHash = null } = {}) {
  const candidates = entries.filter((entry) => entry.stableKey === stableKey && entry.profilePath === profilePath);
  if (!expectedHash) return candidates;
  return [...candidates].sort((left, right) => {
    const leftExact = left.sourceHash === expectedHash ? 0 : 1;
    const rightExact = right.sourceHash === expectedHash ? 0 : 1;
    return leftExact - rightExact;
  });
}

function resolveCacheFile(sourceCache, sourceFile) {
  if (!sourceFile || path.isAbsolute(sourceFile)) return sourceFile;
  return path.resolve(sourceCache, sourceFile);
}

async function validateSourceFile({ entry, sourceCache, expectedHash, sharp }) {
  const sourcePath = resolveCacheFile(sourceCache, entry.sourceFile);
  if (!sourcePath || !(await exists(sourcePath))) throw new SourceFailure("source-not-cached", `Cached portrait is absent: ${sourcePath || "unbound"}`);
  const buffer = await fs.readFile(sourcePath);
  if (buffer.length === 0) throw new SourceFailure("source-empty", `Cached portrait is empty: ${sourcePath}`);
  const sourceHash = sha256(buffer);
  if (entry.sourceHash && sourceHash !== entry.sourceHash) {
    throw new SourceFailure("source-validation-failed", `Cached portrait hash differs from its index binding: ${sourcePath}`);
  }
  if (expectedHash && sourceHash !== expectedHash) {
    throw new SourceFailure("source-validation-failed", `Cached portrait hash differs from the owner-approved source hash: ${sourcePath}`);
  }
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch (error) {
    throw new SourceFailure("source-decode-failed", `Cached portrait cannot be decoded: ${sourcePath}`, { error: error.message });
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width <= 0 || metadata.height <= 0) {
    throw new SourceFailure("source-dimensions-invalid", `Cached portrait dimensions are invalid: ${sourcePath}`);
  }
  if ((entry.width && entry.width !== metadata.width) || (entry.height && entry.height !== metadata.height)) {
    throw new SourceFailure("source-validation-failed", `Cached portrait dimensions differ from the index binding: ${sourcePath}`);
  }
  return {
    sourcePath,
    sourceHash,
    width: metadata.width,
    height: metadata.height,
    exifOrientation: metadata.orientation || entry.exifOrientation || 1,
    format: metadata.format,
    byteCount: buffer.length,
  };
}

export async function resolvePortraitSource({ person, decisions, sourceCache, sharp, expectedHash = null } = {}) {
  const attempts = [];
  let resolved;
  try { resolved = resolveApprovedProfile(person, decisions); } catch (error) {
    return { available: false, fallbackReason: error.reason || "source-validation-failed", sourceStatus: "decision-invalid", profilePathAttempted: null, sourceDecision: "registry-default", decision: null, attempts };
  }
  const { profilePath, sourceDecision, decision } = resolved;
  if (profilePath === null || profilePath === undefined || String(profilePath).trim() === "") {
    return { available: false, fallbackReason: "no-profile-path", sourceStatus: "no-profile-path", profilePathAttempted: profilePath || null, sourceDecision, decision, attempts };
  }
  if (!PROFILE_PATH.test(profilePath)) {
    return { available: false, fallbackReason: "source-validation-failed", sourceStatus: "profile-path-invalid", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  }
  let index;
  try { index = await readSourceCacheIndex(sourceCache); } catch (error) {
    return { available: false, fallbackReason: error.reason || "source-validation-failed", sourceStatus: "cache-index-invalid", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  }
  const requiredHash = decision?.approvedSourceHash || expectedHash;
  const candidates = selectSourceCacheCandidates(index.entries, { stableKey: person.stableKey, profilePath, expectedHash: requiredHash });
  let lastError = null;
  for (const entry of candidates) {
    try {
      const validated = await validateSourceFile({ entry, sourceCache, expectedHash: requiredHash, sharp });
      return { available: true, fallbackReason: null, sourceStatus: "validated-cache-hit", profilePathAttempted: profilePath, sourceDecision, decision, cacheEntry: entry, ...validated, attempts };
    } catch (error) {
      lastError = error;
    }
  }
  if (candidates.length > 0) return { available: false, fallbackReason: lastError?.reason || "source-validation-failed", sourceStatus: "cached-source-invalid", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
  return { available: false, fallbackReason: "source-not-cached", sourceStatus: "source-not-cached", profilePathAttempted: profilePath, sourceDecision, decision, attempts };
}
