import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const auditWorkflow = readFileSync(new URL("../../../.github/workflows/audit-people-hero-refresh.yml", import.meta.url), "utf8");
const promotionWorkflow = readFileSync(new URL("../../../.github/workflows/promote-people-hero-refresh.yml", import.meta.url), "utf8");

test("scheduled refresh uses the locked cadence, cap, live proxy, and staging-only issue boundary", () => {
  assert.match(auditWorkflow, /cron: "17 3 3 2,4,6,8,10,12 \*"/u);
  assert.match(auditWorkflow, /audit:\n\s+runs-on: windows-latest/u);
  assert.match(auditWorkflow, /audit:[\s\S]*?node-version: 22[\s\S]*?Validate repository before audit/u);
  assert.match(auditWorkflow, /\$auditArguments = @\(/u);
  assert.doesNotMatch(auditWorkflow, /args=\(/u);
  assert.match(auditWorkflow, /"--stage-limit", "30"/u);
  assert.match(auditWorkflow, /PEOPLE_HERO_PROXY_URL/u);
  assert.match(auditWorkflow, /PEOPLE_HERO_PROXY_TOKEN/u);
  assert.match(auditWorkflow, /max-parallel: 5/u);
  assert.match(auditWorkflow, /people-hero:refresh-stage/u);
  assert.match(auditWorkflow, /gh issue create/u);
  assert.match(auditWorkflow, /needs\.audit\.outputs\.issue_needed == 'true'/u);
  assert.match(auditWorkflow, /retention-days: 30/u);
  assert.doesNotMatch(auditWorkflow, /gh pr create|gh pr merge|assets\/people\/\$\{/u);
});

test("refresh promotion trusts main staging, copies reviewed bytes, and opens only a draft PR", () => {
  assert.match(promotionWorkflow, /github\.ref.*refs\/heads\/main/u);
  assert.match(promotionWorkflow, /Audit and stage People hero refreshes/u);
  assert.match(promotionWorkflow, /Stage People hero batch/u);
  assert.match(promotionWorkflow, /Stage one People hero/u);
  assert.match(promotionWorkflow, /git merge-base --is-ancestor/u);
  assert.match(promotionWorkflow, /people-hero:refresh-promote/u);
  assert.match(promotionWorkflow, /gh pr create --draft/u);
  assert.match(promotionWorkflow, /Refs #/u);
  assert.doesNotMatch(promotionWorkflow, /gh pr merge|Closes #/u);
  assert.doesNotMatch(promotionWorkflow, /PEOPLE_HERO_PROXY|TMDB_BEARER_TOKEN|api_key/iu);
});
