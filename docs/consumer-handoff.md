# People consumer handoff

`nuvio-people-assets` is the canonical public source for Nuvio People identities, actor/director membership, and People artwork.

## Machine-readable authority

Consume:

```text
https://raw.githubusercontent.com/davecollections/nuvio-people-assets/main/manifests/people.json
```

`manifests/people.json` is deterministically rebuilt from `data/people.json` and the physical `assets/people/` tree. Consumers should read `recordCount` and `assetCounts` from the manifest rather than hard-coding catalogue totals.

Each `people` record provides:

- numeric `tmdbPersonId` identity;
- display-only `canonicalName`;
- `categoryMembership`, using `actor`, `director`, or both;
- an `assets` object containing path, raw URL, SHA-256, bytes, dimensions, and format.

TMDB Person ID is the stable key. A display-name change must not change a directory or consumer identity.

## Stable per-person paths

Every registered identity has these four core files:

```text
assets/people/{tmdbPersonId}/poster.webp
assets/people/{tmdbPersonId}/landscape.webp
assets/people/{tmdbPersonId}/title-logo.png
assets/people/{tmdbPersonId}/hero.webp
```

When `assets.focusPoster` and `assets.focusLandscape` are present, use the complete optional colour-focus pair:

```text
assets/people/{tmdbPersonId}/focus-poster.webp
assets/people/{tmdbPersonId}/focus-landscape.webp
```

The pair is all-or-nothing. Kátia Lund (`8559`) and Shimit Amin (`76447`) intentionally have no focus pair because no approved profile source exists. Consumers must treat absence as supported state rather than synthesising a URL.

## Cache behaviour

Paths are stable, so a path alone is not a cache version. Use the corresponding manifest asset `sha256` as the cache key or comparison value. Refresh a cached file only when that hash changes.

Do not infer freshness from a display name, catalogue position, manually copied count, or the historical 1,480-person migration records. Fetch or revalidate the canonical manifest on the consumer's chosen schedule, compare hashes, and retain unchanged assets.

## Migration from `nuvio-assets`

The old People paths use a different directory shape:

```text
assets/collection_covers/people/poster/{tmdbPersonId}.webp
assets/collection_covers/people/landscape/{tmdbPersonId}.webp
assets/collection_covers/people/title-logo/{tmdbPersonId}.png
```

A consumer migration should:

1. switch People identity and category data to this repository's manifest;
2. resolve all People artwork through each manifest record rather than constructing undocumented paths;
3. use manifest SHA-256 values for cache invalidation;
4. preserve company and network resolution from `nuvio-assets`;
5. update People runtime code, builder code, fixtures, tests, and documentation together; and
6. verify the deployed consumer before requesting removal of any legacy files.

Legacy People files in `nuvio-assets` must remain until Dave explicitly confirms that migration is merged and verified. Shared category artwork and the unrelated Jane Austen custom collection image also require separate disposition decisions; see `people-workflow-decommission.md`.
