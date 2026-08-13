import assert from "node:assert/strict";
import test from "node:test";

import {
  validateFocusArtworkContract,
  validateFocusArtworkPair,
  validateHeroContract
} from "../../../scripts/lib/inventory.mjs";

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

test("focus artwork validation requires a correctly sized poster/landscape pair", () => {
  const focusPoster = {
    path: "assets/people/1/focus-poster.webp",
    width: 1000,
    height: 1500
  };
  const focusLandscape = {
    path: "assets/people/1/focus-landscape.webp",
    width: 1200,
    height: 675
  };
  assert.doesNotThrow(() => validateFocusArtworkContract(focusPoster, "focusPoster"));
  assert.doesNotThrow(() => validateFocusArtworkContract(focusLandscape, "focusLandscape"));
  assert.doesNotThrow(() => validateFocusArtworkPair({ focusPoster, focusLandscape }, 1));
  assert.doesNotThrow(() => validateFocusArtworkPair({}, 2));
  assert.throws(
    () => validateFocusArtworkContract({ ...focusPoster, width: 999 }, "focusPoster"),
    /focusPoster must be exactly 1000x1500/u
  );
  assert.throws(
    () => validateFocusArtworkPair({ focusPoster }, 3),
    /focus-poster\.webp and focus-landscape\.webp must be published together/u
  );
});
