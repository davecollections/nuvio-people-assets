import assert from "node:assert/strict";
import test from "node:test";

import { validateHeroContract } from "../../../scripts/lib/inventory.mjs";

test("hero validation accepts legacy and current dimensions without making 250 KiB a hard limit", () => {
  assert.doesNotThrow(() => validateHeroContract({
    path: "assets/people/1/hero.webp",
    width: 1920,
    height: 1080,
    bytes: 200000
  }));
  assert.doesNotThrow(() => validateHeroContract({
    path: "assets/people/2/hero.webp",
    width: 2560,
    height: 1440,
    bytes: 300000
  }));
  assert.throws(() => validateHeroContract({
    path: "assets/people/3/hero.webp",
    width: 1280,
    height: 720,
    bytes: 100000
  }), /hero must be exactly 1920x1080 or 2560x1440/u);
});
