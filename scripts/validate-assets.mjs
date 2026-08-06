import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildInventory, repositoryRoot } from "./lib/inventory.mjs";

const inventory = await buildInventory();
const manifestPath = path.join(repositoryRoot(), "manifests", "people.json");
const actual = await readFile(manifestPath, "utf8");
const expected = `${JSON.stringify(inventory, null, 2)}\n`;

if (actual !== expected) {
  throw new Error("manifests/people.json is stale; run npm run manifest and review the changes");
}

const totalAssets = Object.values(inventory.assetCounts).reduce((sum, count) => sum + count, 0);
console.log(`Validated ${inventory.recordCount} people and ${totalAssets} assets.`);
console.log(`Asset bytes: ${inventory.totalAssetBytes}`);
console.log(`Hero count: ${inventory.assetCounts.hero}`);
