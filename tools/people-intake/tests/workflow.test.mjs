import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL(
  "../../../.github/workflows/stage-new-people.yml",
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
