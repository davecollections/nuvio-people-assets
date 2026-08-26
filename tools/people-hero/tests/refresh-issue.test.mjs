import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRefreshIssueBundle } from "../src/refresh-issue.mjs";
import { stableJson } from "../src/refresh-state.mjs";

async function writeAudit(workRoot, name, report) {
  const artifactRoot = path.join(workRoot, name, "artifacts");
  const reportsRoot = path.join(artifactRoot, "audit", "reports");
  const outputRoot = path.join(workRoot, name, "issue");
  await mkdir(reportsRoot, { recursive: true });
  await writeFile(path.join(reportsRoot, "refresh-audit.json"), stableJson(report), "utf8");
  return { artifactRoot, outputRoot };
}

test("refresh issue evidence reports fail-closed metadata failures", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "nuvio-refresh-issue-"));
  const paths = await writeAudit(workRoot, "failure", {
    status: "incomplete-no-staging",
    requestedPersonCount: 1532,
    failures: [{ tmdbPersonId: 31, canonicalName: "Tom Hanks", error: "temporary upstream failure" }],
    outcomeCounts: { filmography: 1531, "profile-only": 0, "sparse-fallback": 0, skip: 0 }
  });
  const bundle = await buildRefreshIssueBundle({
    ...paths,
    runId: "100",
    runUrl: "https://github.example/actions/runs/100",
    allowedWorkRoot: workRoot
  });
  assert.equal(bundle.summary.issueNeeded, true);
  assert.deepEqual(bundle.summary.failurePersonIds, [31]);
  const body = await readFile(bundle.bodyPath, "utf8");
  assert.match(body, /Metadata failures — no candidates were staged/u);
  assert.match(body, /Tom Hanks \(31\)/u);
});

test("refresh issue evidence marks a successful no-change audit as unnecessary", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "nuvio-refresh-issue-"));
  const paths = await writeAudit(workRoot, "no-change", {
    status: "audit-complete",
    requestedPersonCount: 1532,
    failures: [],
    changes: [],
    changeCount: 0,
    stageCount: 0,
    attentionCount: 0,
    overflowCount: 0,
    outcomeCounts: { filmography: 1452, "profile-only": 1, "sparse-fallback": 79, skip: 0 }
  });
  const bundle = await buildRefreshIssueBundle({
    ...paths,
    runId: "101",
    runUrl: "https://github.example/actions/runs/101",
    allowedWorkRoot: workRoot
  });
  assert.equal(bundle.summary.issueNeeded, false);
  assert.deepEqual(bundle.summary.stagedPersonIds, []);
});
