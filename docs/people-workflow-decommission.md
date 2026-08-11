# Retiring People work from `nuvio-assets`

People must not be removed from `nuvio-assets` until every item below is complete. Studio and network generation remains in that repository throughout.

## Completed in issue #23

- All 1,480 current poster, landscape, and title-logo assets were compared between repositories.
- The rich People registry, seeds, supplements, source provenance, portrait decisions, crop decisions, schemas, five render presets, exact font input, and legacy source/output manifests were migrated here.
- All 1,478 non-fallback portrait sources were hash-verified across the seven preserved old caches and hard-linked into `tools/people-seed/.work/migrated-source-cache-v1`; the other two identities are intentional text fallbacks.
- Offline proofs for George Lucas (1), Tom Hanks (31), and Kátia Lund (8559) reproduced the current poster, landscape, and title-logo hashes exactly.
- The Tom Hanks tight-canvas title-logo correction is now represented by an exact-ID, input-hash-bound output override.
- The migrated tool accepts only 1–30 explicit IDs, makes no network requests, and writes only below its ignored `.work` directory.

## Still blocking removal

1. Merge and retain the issue #23 migration in `nuvio-people-assets`.
2. Update `tmdb-id-lookup` to resolve People from this repository while leaving company and network resolution on `nuvio-assets`.
3. Verify its runtime code, builder code, tests, fixtures, and documentation no longer require `assets/collection_covers/people/*` or the People section of the old shared runtime lookup.
4. Decide whether the old People URLs need a compatibility window or permanent compatibility copies.
5. Open a separate focused issue and branch in `nuvio-assets`; remove only reviewed People-specific files and rebuild its studio/network-only runtime lookup.
6. Preserve or deliberately disposition the old dirty `work/people-title-logo-tight-crop-test` branch and uncommitted hero prototype before any local cleanup.

The ignored hard-link archive means removing the original old source files later will not remove the new local links. It is still local working data and is not included in a fresh Git clone; the compact tracked manifests preserve the exact required source hashes and profile paths.

No old-repository deletion is authorised by this document.
