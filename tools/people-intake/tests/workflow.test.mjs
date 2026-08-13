import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL(
  "../../../.github/workflows/stage-new-people.yml",
  import.meta.url,
);
const promotionWorkflowPath = new URL(
  "../../../.github/workflows/promote-new-people.yml",
  import.meta.url,
);

test("new People staging uses the locked Windows runtime and PowerShell environment syntax", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const windowsRunners = workflow.match(
    /^\s+runs-on:\s+windows-latest\s*$/gmu,
  );
  const nodeRuntimes = workflow.match(/^\s+node-version:\s+22\s*$/gmu);

  assert.equal(windowsRunners?.length, 2);
  assert.equal(nodeRuntimes?.length, 2);
  assert.doesNotMatch(workflow, /^\s+runs-on:\s+ubuntu-latest\s*$/gmu);
  assert.doesNotMatch(workflow, /^\s+node-version:\s+20\s*$/gmu);
  assert.match(
    workflow,
    /batch-input\.mjs >> \$env:GITHUB_OUTPUT/u,
  );
  assert.match(
    workflow,
    /--person-id "\$env:REQUESTED_PERSON_ID"/u,
  );
  assert.doesNotMatch(workflow, /"\$GITHUB_OUTPUT"/u);
  assert.doesNotMatch(workflow, /"\$REQUESTED_PERSON_ID"/u);
});

test("new People promotion trusts only successful main staging and opens a draft review PR", () => {
  const workflow = readFileSync(promotionWorkflowPath, "utf8");
  assert.match(workflow, /^\s+runs-on:\s+windows-latest\s*$/mu);
  assert.match(workflow, /^\s+node-version:\s+22\s*$/mu);
  assert.match(workflow, /github\.ref.*refs\/heads\/main/u);
  assert.match(workflow, /workflowName -ne "Stage new People artwork set"/u);
  assert.match(workflow, /headBranch -ne "main"/u);
  assert.match(workflow, /git merge-base --is-ancestor/u);
  assert.match(workflow, /can_approve_pull_request_reviews/u);
  assert.match(workflow, /gh run download/u);
  assert.match(workflow, /npm run people-intake:promote/u);
  assert.match(workflow, /gh pr create --draft/u);
  assert.doesNotMatch(workflow, /gh pr merge/u);
  assert.doesNotMatch(workflow, /PEOPLE_HERO_PROXY|TMDB_BEARER_TOKEN|api_key/iu);
});
