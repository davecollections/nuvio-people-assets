# Retiring People work from `nuvio-assets`

This repository is the canonical source for People identities and per-person artwork. That does **not** yet authorise removal of the legacy People files from `nuvio-assets`.

The current catalogue size and asset counts must always be read from `manifests/people.json`; the figures below are a dated migration audit, not configuration constants.

## Completed migration work

- The issue #23 migration and later People artwork work are present on `main` in this repository.
- The canonical manifest currently reconciles the registry and physical tree without orphan or manifest-only identities.
- The original 1,480 `nuvio-assets` identities are all present here with identical category memberships.
- All 1,480 legacy posters and all 1,480 legacy landscapes match their canonical counterparts byte-for-byte.
- All 1,480 legacy title logos are superseded by the approved current title-logo design. Their bytes intentionally differ from the legacy files.
- Later identities are recorded through the intake publication ledger rather than being appended to the frozen 1,480-record migration evidence below `data/people-base/`.
- Current validation requires every registered identity to have `poster.webp`, `landscape.webp`, `title-logo.png`, and `hero.webp`, and requires focus artwork to be a valid pair when present.

## Consumer migration still pending

The corresponding `tmdb-id-lookup` migration is outside this repository and remains incomplete. It must be handled and verified separately.

Before any legacy deletion, Dave must explicitly confirm that the consumer change is merged and verified to:

1. load People identities and category memberships from `nuvio-people-assets/manifests/people.json`;
2. resolve the canonical per-person paths documented in `consumer-handoff.md`;
3. use the manifest's per-asset SHA-256 values for cache invalidation;
4. leave company and network resolution on `nuvio-assets`;
5. stop requiring the People section of `nuvio-assets/assets/collection_covers/runtime-lookup.json` and the old People manifests or paths;
6. cover runtime code, builder code, tests, fixtures, and documentation; and
7. complete any approved compatibility window for old URLs.

No consumer-migration completion is claimed here.

## Read-only legacy inventory

Audited on 2026-08-15 from the existing `nuvio-assets` working tree. That repository was not modified, cleaned, switched, or reset. It was on `work/watch-provider-artwork-maintenance` with an unrelated modification to `data/watch-providers/artwork-map.json`; that work must remain undisturbed.

### 1. Per-person files already superseded here

| Legacy path | Physical files | Disposition after the gate |
| --- | ---: | --- |
| `assets/collection_covers/people/poster/{tmdbPersonId}.webp` | 1,480 | Remove only after consumer migration and any compatibility window. Exact canonical bytes exist at `assets/people/{tmdbPersonId}/poster.webp`. |
| `assets/collection_covers/people/landscape/{tmdbPersonId}.webp` | 1,480 | Remove only after consumer migration and any compatibility window. Exact canonical bytes exist at `assets/people/{tmdbPersonId}/landscape.webp`. |
| `assets/collection_covers/people/title-logo/{tmdbPersonId}.png` | 1,480 | Remove only after consumer migration and any compatibility window. Current canonical title logos intentionally use the newer approved design. |

The old identity set is a complete subset of the canonical manifest. The current manifest has additional later-published identities; consumers must not infer the current catalogue from the historical 1,480 boundary.

### 2. Shared People category artwork requiring an owner decision

These are not per-person ID assets and must not be deleted as part of a blanket directory removal:

- `assets/collection_covers/people/actor hero.jpg`
- `assets/collection_covers/people/actors.jpg`
- `assets/collection_covers/people/director hero.jpg`
- `assets/collection_covers/people/directors.jpg`
- `assets/collection_covers/people/people.jpg`
- `assets/collection_covers/people/people hero backdrop.jpg`

The shared backdrop is recorded by the old presentation manifest. The other five shared images have no tracked runtime reference beyond preservation tests, but external hard-coded URL use cannot be ruled out from this repository alone. Dave must decide whether each asset remains in `nuvio-assets`, moves to a reviewed permanent path, receives a compatibility copy, or is retired after consumer verification.

### 3. Non-person custom collection artwork

- `assets/collection_covers/people/jane_austen_collection.jpg`

This is a custom collection image, not a TMDB Person identity. It must remain outside any People-specific deletion. Its permanent `nuvio-assets` destination is an owner decision.

### 4. Old manifests, runtime records, data, schemas, tooling, and tests

These can be retired or narrowed only in a later focused `nuvio-assets` issue after the consumer gate:

- `assets/collection_covers/people/manifest.json`
- `assets/collection_covers/people/presentation-manifest.json`
- the `people` map and People source-manifest binding in `assets/collection_covers/runtime-lookup.json`
- People-specific runtime generation and validation branches in `tools/artwork-runtime-lookup/`, plus their tests and schema requirements
- `data/people/`
- `schemas/people-*.schema.json`
- `tools/people-seed/`
- `docs/people-artwork-policy.md`
- stale People publication sections in the `nuvio-assets` README and related documentation
- People-specific validation and preservation expectations that would otherwise require deleted files

The shared studio/network runtime must be rebuilt and validated without its People section rather than deleting the complete runtime lookup or its company/network responsibilities.

### 5. Known live dependency

`nuvio-assets/assets/collection_covers/runtime-lookup.json` is currently a published schema-version-2 lookup with 1,480 People entries. It declares the old People artwork manifest as its source and resolves the old poster and landscape paths. The separate consumer migration is therefore a hard blocker.

The old title-logo presentation manifest and shared People backdrop are not part of that runtime lookup. Their compatibility need remains an owner decision because consumers outside the tracked runtime cannot be disproved here.

## Decommission checklist

- [x] Canonical People registry, assets, and deterministic manifest exist in `nuvio-people-assets`.
- [x] Original 1,480 identities and category memberships are covered here.
- [x] Legacy poster and landscape byte parity is confirmed.
- [x] Current title logos, per-person heroes, and permitted focus pairs are canonical here.
- [x] Consumer handoff contract is documented.
- [ ] `tmdb-id-lookup` consumer migration is merged and verified.
- [ ] Dave confirms the compatibility policy for old People URLs.
- [ ] Dave decides the permanent disposition of all six shared People category assets.
- [ ] Dave decides the permanent `nuvio-assets` path for `jane_austen_collection.jpg`.
- [ ] Unrelated work in the `nuvio-assets` checkout is completed or safely preserved.
- [ ] A separate focused `nuvio-assets` issue and branch review the exact deletion set.
- [ ] The studio/network runtime lookup is rebuilt without People and all affected tests pass.
- [ ] Dave explicitly approves that deletion pull request.

Legacy `nuvio-assets` deletion is **not authorised** until every applicable unchecked item is complete.

## Optional later history cleanup

Removing tracked files in a normal pull request does not remove their historical Git objects. Any history rewrite would be a separate destructive project requiring an explicit owner decision, a fresh backup and coordination plan, rewritten-clone instructions, and its own approval. It is not part of the consumer migration or normal decommission pull request.
