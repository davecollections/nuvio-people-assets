import assert from "node:assert/strict";
import test from "node:test";

import { fetchSnapshotWithRetries, parseRefreshAuditArguments } from "../src/refresh-audit.mjs";

test("refresh audit CLI locks catalogue, explicit, force, and stage-limit boundaries", () => {
  assert.deepEqual(parseRefreshAuditArguments(["--all"]).all, true);
  assert.deepEqual(parseRefreshAuditArguments(["--person-ids", "31, 500", "--force"]).personIds, [31, 500]);
  assert.throws(() => parseRefreshAuditArguments(["--all", "--person-ids", "31"]), /exactly one/u);
  assert.throws(() => parseRefreshAuditArguments(["--all", "--force"]), /explicit/u);
  assert.throws(() => parseRefreshAuditArguments(["--person-ids", Array.from({ length: 31 }, (_, index) => index + 1).join(",")]), /at most 30/u);
  assert.throws(() => parseRefreshAuditArguments(["--all", "--stage-limit", "31"]), /cannot exceed 30/u);
});

test("refresh metadata requests retry twice and return the live third result", async () => {
  let calls = 0;
  let attempts = 0;
  const delays = [];
  const snapshot = await fetchSnapshotWithRetries({
    personId: 31,
    client: {
      async getPersonSnapshot() {
        calls += 1;
        if (calls < 3) throw new Error("temporary upstream failure");
        return { id: 31 };
      }
    },
    delayImpl: async (milliseconds) => delays.push(milliseconds),
    onAttempt: () => { attempts += 1; }
  });
  assert.deepEqual(snapshot, { id: 31 });
  assert.equal(calls, 3);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("refresh metadata requests fail clearly after bounded retries", async () => {
  let calls = 0;
  await assert.rejects(fetchSnapshotWithRetries({
    personId: 31,
    client: { async getPersonSnapshot() { calls += 1; throw new Error("offline"); } },
    delayImpl: async () => {}
  }), /failed after 3 attempts: offline/u);
  assert.equal(calls, 3);
});
