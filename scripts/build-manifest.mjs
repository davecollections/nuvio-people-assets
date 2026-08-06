import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildInventory, repositoryRoot } from "./lib/inventory.mjs";

const inventory = await buildInventory();
const outputDirectory = path.join(repositoryRoot(), "manifests");
const outputPath = path.join(outputDirectory, "people.json");

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputPath}`);
console.log(`People: ${inventory.recordCount}`);
console.log(`Assets: ${Object.values(inventory.assetCounts).reduce((sum, count) => sum + count, 0)}`);
console.log(`Bytes: ${inventory.totalAssetBytes}`);
