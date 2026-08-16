# People base-artwork source record

This directory preserves the frozen People-only migration inputs for the original 1,480 identities. It was migrated from `davecollections/nuvio-assets` at commit `5a63129` under issue #23. Those records reproduce the current `poster.webp` and `landscape.webp` bytes plus the historical title-logo design; the separately approved current V2 title-logo publication is recorded here as well.

The canonical public identity list remains `data/people.json`. The richer files here are regeneration provenance rather than a second public registry:

- `people-registry.json` retains all 1,480 resolved identities, profile paths, aliases, identity evidence, credit counts, category membership, and source occurrences.
- the actor/director seeds and owner supplements retain the deterministic inputs from which that rich registry was assembled;
- `sources.json` retains the 15 catalogue-source records and their limitations;
- `portrait-source-decisions.json` binds the seven owner-selected profile substitutions;
- the landscape crop and chin-safe files retain all source-bound framing exceptions;
- `title-logo-line-break-overrides.json` retains the explicit typography exception surface;
- `title-logo-output-overrides.json` binds the single approved Tom Hanks transparent-canvas tightening needed to reproduce the historical post-migration title-logo bytes;
- `legacy-artwork-manifest.json` binds every portrait source hash and every approved poster/landscape output hash;
- `legacy-presentation-manifest.json` binds the migrated historical title-logo snapshot and renderer/font evidence;
- `title-logo-v2-publication.json` binds the owner-approved 1600 x 480 V2 title-logo bytes published for all original 1,480 identities under issue #37.

The two legacy manifests deliberately preserve their historical `nuvio-assets` paths and URLs. They are immutable reproduction evidence, not current consumer manifests. Later identities are recorded through `data/people-intake-publications.json` rather than appended to this frozen migration set. Current consumers must use `manifests/people.json`.

Portrait source bytes and bulky review evidence remain ignored. The offline staging tool requires one or more explicitly supplied source caches and verifies those bytes against the migrated source hashes before rendering.
