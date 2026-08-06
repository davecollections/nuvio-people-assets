import assert from "node:assert/strict";
import test from "node:test";

import { createTmdbProxyClient, tmdbProxyServiceHeader } from "../src/tmdb-proxy-client.mjs";

test("proxy client keeps service access out of the URL and requests one combined snapshot", async () => {
  const calls = [];
  const client = createTmdbProxyClient({
    baseUrl: "https://proxy.example",
    serviceToken: "in-memory-test-value",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ id: 31, name: "Tom Hanks" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const person = await client.getPersonSnapshot(31);
  assert.equal(person.id, 31);
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.pathname, "/3/person/31");
  assert.equal(requestUrl.searchParams.get("append_to_response"), "combined_credits,images");
  assert.ok(!calls[0].url.includes("in-memory-test-value"));
  assert.equal(calls[0].options.headers[tmdbProxyServiceHeader], "in-memory-test-value");
});

test("proxy client rejects unsafe origins and mismatched identities", async () => {
  assert.throws(() => createTmdbProxyClient({ baseUrl: "http://proxy.example" }), /HTTPS/u);
  const client = createTmdbProxyClient({
    baseUrl: "https://proxy.example",
    fetchImpl: async () => new Response(JSON.stringify({ id: 32 }), { status: 200 })
  });
  await assert.rejects(() => client.getPersonSnapshot(31), /wrong identity/u);
});
