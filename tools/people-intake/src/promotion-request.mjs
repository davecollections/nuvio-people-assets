#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertPromotionWorkPath, parsePromotionApprovals } from "./promote.mjs";

function positiveInteger(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/u.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return Number(raw);
}

export function validatePromotionRequest({ stagingRunId, trackingIssue, promotionRunId, approvalsJson }) {
  return {
    stagingRunId: positiveInteger(stagingRunId, "Staging run ID"),
    trackingIssue: positiveInteger(trackingIssue, "Tracking issue"),
    promotionRunId: positiveInteger(promotionRunId, "Promotion run ID"),
    approvals: parsePromotionApprovals(approvalsJson)
  };
}

async function main() {
  const request = validatePromotionRequest({
    stagingRunId: process.env.STAGING_RUN_ID,
    trackingIssue: process.env.TRACKING_ISSUE,
    promotionRunId: process.env.GITHUB_RUN_ID,
    approvalsJson: process.env.PEOPLE_PROMOTION_APPROVALS
  });
  const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".work");
  const root = assertPromotionWorkPath(path.join(
    workRoot,
    `promotion-${request.promotionRunId}`
  ));
  const approvalsFile = path.join(root, "owner-approvals.json");
  await mkdir(workRoot, { recursive: true });
  await mkdir(root, { recursive: false });
  await writeFile(approvalsFile, `${JSON.stringify({
    version: request.approvals.version,
    status: request.approvals.status,
    approvals: request.approvals.approvals
  }, null, 2)}\n`, "utf8");
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) throw new Error("GITHUB_OUTPUT is required");
  await appendFile(githubOutput, [
    `staging_run_id=${request.stagingRunId}`,
    `tracking_issue=${request.trackingIssue}`,
    `request_root=${root.replaceAll("\\", "/")}`,
    `approvals_file=${approvalsFile.replaceAll("\\", "/")}`,
    `approved_person_ids=${request.approvals.approvals.map((approval) => approval.tmdbPersonId).join(",")}`
  ].join("\n") + "\n", "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
