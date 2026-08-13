import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const proofCommit = "2c480b4569679d476a8ab970a3fcb9672f05fbfa";
const expectedIds = [31, 64, 1100, 1650, 1922, 6730, 14386, 76594, 234352, 1136406];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

for (const orientation of ["poster", "landscape"]) {
  test(`the ${orientation} Nuvio focus proof uses immutable paired People assets`, async () => {
    const document = await readJson(`proofs/issue-41/people-focus-${orientation}.nuvio.json`);
    assert.equal(document.length, 1);
    const collection = document[0];
    assert.equal(collection.folders.length, expectedIds.length);
    assert.deepEqual(
      collection.folders.map((folder) => folder.sources[0].tmdbId),
      expectedIds
    );
    for (const folder of collection.folders) {
      const personId = folder.sources[0].tmdbId;
      assert.equal(folder.tileShape, orientation.toUpperCase());
      assert.equal(folder.hideTitle, true);
      assert.equal(folder.focusGifEnabled, true);
      assert.equal(folder.sources[0].provider, "tmdb");
      assert.match(folder.coverImageUrl, new RegExp(
        `^https://raw\\.githubusercontent\\.com/davecollections/nuvio-people-assets/${proofCommit}/assets/people/${personId}/${orientation}\\.webp$`,
        "u"
      ));
      assert.match(folder.focusGifUrl, new RegExp(
        `^https://raw\\.githubusercontent\\.com/davecollections/nuvio-people-assets/${proofCommit}/assets/people/${personId}/focus-${orientation}\\.webp$`,
        "u"
      ));
    }
  });
}
