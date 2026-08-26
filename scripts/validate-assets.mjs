import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildInventory, repositoryRoot } from "./lib/inventory.mjs";
import { stableJson, validateRefreshState } from "../tools/people-hero/src/refresh-state.mjs";

const inventory = await buildInventory();
const root = repositoryRoot();
const manifestPath = path.join(root, "manifests", "people.json");
const refreshStatePath = path.join(root, "data", "people-hero-refresh-state.json");
const registryPath = path.join(root, "data", "people.json");
const [actual, refreshStateText, registry] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(refreshStatePath, "utf8"),
  readFile(registryPath, "utf8").then(JSON.parse)
]);
const expected = `${JSON.stringify(inventory, null, 2)}\n`;

if (actual !== expected) {
  throw new Error("manifests/people.json is stale; run npm run manifest and review the changes");
}
const refreshState = JSON.parse(refreshStateText);
if (refreshStateText !== stableJson(refreshState)) {
  throw new Error("data/people-hero-refresh-state.json is not stably serialized");
}
validateRefreshState({ state: refreshState, registry, manifest: inventory });

const totalAssets = Object.values(inventory.assetCounts).reduce((sum, count) => sum + count, 0);
console.log(`Validated ${inventory.recordCount} people and ${totalAssets} assets.`);
console.log(`Asset bytes: ${inventory.totalAssetBytes}`);
console.log(`Hero count: ${inventory.assetCounts.hero}`);
console.log(`Focus artwork pairs: ${inventory.assetCounts.focusPoster}`);
console.log(`Hero refresh-state records: ${refreshState.recordCount}`);
