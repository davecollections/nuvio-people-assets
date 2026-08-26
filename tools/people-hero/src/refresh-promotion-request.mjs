#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseRefreshPromotionApprovals } from "./refresh-promote.mjs";
import { stableJson } from "./refresh-state.mjs";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(toolRoot, ".work");

function positiveInteger(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/u.test(raw)) throw new Error(`${label} must be a positive integer`);
  const result = Number(raw);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the safe integer range`);
  return result;
}

export function validateRefreshPromotionRequest({ stagingRunId, trackingIssue, promotionRunId, approvalsJson }) {
  return {
    stagingRunId: positiveInteger(stagingRunId, "staging run ID"),
    trackingIssue: positiveInteger(trackingIssue, "tracking issue"),
    promotionRunId: positiveInteger(promotionRunId, "promotion run ID"),
    approvals: parseRefreshPromotionApprovals(approvalsJson)
  };
}

async function main() {
  const request = validateRefreshPromotionRequest({
    stagingRunId: process.env.REFRESH_STAGING_RUN_ID,
    trackingIssue: process.env.REFRESH_TRACKING_ISSUE,
    promotionRunId: process.env.REFRESH_PROMOTION_RUN_ID,
    approvalsJson: process.env.REFRESH_PROMOTION_APPROVALS
  });
  const root = path.join(workRoot, `promotion-${request.promotionRunId}`);
  await mkdir(root, { recursive: false });
  const approvalsFile = path.join(root, "owner-approvals.json");
  await writeFile(approvalsFile, stableJson(request.approvals), "utf8");
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) throw new Error("GITHUB_OUTPUT is required");
  await appendFile(outputFile, [
    `staging_run_id=${request.stagingRunId}`,
    `tracking_issue=${request.trackingIssue}`,
    `request_root=${root.split(path.sep).join("/")}`,
    `approvals_file=${approvalsFile.split(path.sep).join("/")}`,
    `approved_person_ids=${request.approvals.approvals.map((approval) => approval.tmdbPersonId).join(",")}`
  ].join("\n") + "\n", "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
