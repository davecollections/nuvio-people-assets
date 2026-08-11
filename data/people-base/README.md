# People base-artwork source record

This directory preserves the People-only inputs required to reproduce the existing `poster.webp`, `landscape.webp`, and `title-logo.png` assets. It was migrated from `davecollections/nuvio-assets` at commit `5a63129` under issue #23.

The canonical public identity list remains `data/people.json`. The richer files here are regeneration provenance rather than a second public registry:

- `people-registry.json` retains all 1,480 resolved identities, profile paths, aliases, identity evidence, credit counts, category membership, and source occurrences.
- the actor/director seeds and owner supplements retain the deterministic inputs from which that rich registry was assembled;
- `sources.json` retains the 15 catalogue-source records and their limitations;
- `portrait-source-decisions.json` binds the seven owner-selected profile substitutions;
- the landscape crop and chin-safe files retain all source-bound framing exceptions;
- `title-logo-line-break-overrides.json` retains the explicit typography exception surface;
- `title-logo-output-overrides.json` binds the single approved Tom Hanks transparent-canvas tightening needed to reproduce the current title-logo bytes;
- `legacy-artwork-manifest.json` binds every portrait source hash and every approved poster/landscape output hash;
- `legacy-presentation-manifest.json` binds every approved title-logo output hash and renderer/font evidence.

The two legacy manifests deliberately preserve their historical `nuvio-assets` paths and URLs. They are immutable reproduction evidence, not current consumer manifests. Current consumers must use `manifests/people.json`.

Portrait source bytes and bulky review evidence remain ignored. The offline staging tool requires one or more explicitly supplied source caches and verifies those bytes against the migrated source hashes before rendering.
