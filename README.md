# Nuvio People Assets

Public artwork assets for People collections in Nuvio.

Each person has a stable, TMDB-ID-based directory:

```text
assets/people/{tmdb_person_id}/
  poster.webp      # required
  title-logo.png   # required
  landscape.webp   # required; retained for current/V1 compatibility
  hero.webp        # required approved filmography, profile-only, or sparse hero
  focus-poster.webp     # optional static colour focus counterpart
  focus-landscape.webp  # optional static colour focus counterpart
```

For example, Tom Hanks is stored under `assets/people/31/`.

## Asset contract

- `poster.webp`, `landscape.webp`, `title-logo.png`, and `hero.webp` are required for every registry entry. Landscape remains a current/V1 compatibility asset, but it is part of the canonical consumer contract until a separately approved V2 decision changes that contract.
- New heroes use the `people-t2-perspective-v2` design: 2560 x 1440, T2 perspective layout, and WebP quality 82.
- Focus artwork is published as a pair wherever a preserved approved portrait source exists. `focus-poster.webp` is 1000 x 1500 and `focus-landscape.webp` is 1200 x 675; both are static WebP quality 82 files generated from the same approved portrait, crop, gradients, grain, and typography as their monochrome counterparts, with only the grayscale and warm-tint treatment removed. Kátia Lund (`8559`) and Shimit Amin (`76447`) intentionally have no focus pair because no approved profile source exists.
- Filmography heroes use 15–32 eligible, distinct movie/TV credits. Principal-performer concert and performance films may qualify when TMDB records them as Music-genre movies with the person billed first; ordinary `Self` appearances remain excluded. The approved full-bleed T2 lattice places every selected source before using deterministic low-salience fallback placements to keep the perspective crop complete. Profile-only heroes are permitted when fewer than 15 credits qualify but at least 15 suitable official profile images exist.
- When neither normal threshold is met but at least one eligible credit has official artwork, a sparse fallback uses every eligible credit in the T2 lattice and applies the locked cinematic defocus and dark grading. This hides unavoidable repetition without admitting excluded credits; the separate title logo is never baked into the hero. Refreshes automatically replace the fallback when a normal hero becomes eligible.
- Paths are identity-based and must not be renamed when a person's display name changes.
- `manifests/people.json` is the canonical machine-readable authority for People identities, actor/director category memberships, and artwork inventory. It includes per-asset SHA-256 hashes, dimensions, byte counts, and direct raw GitHub URLs.

Consumers may use the stable `main` URLs and compare the per-asset hashes in the manifest when deciding whether to refresh cached artwork. See the practical [consumer handoff](docs/consumer-handoff.md) before migrating from the legacy `nuvio-assets` People paths.

## Source and rights

People imagery and film/TV artwork originate from TMDB. This repository does not claim ownership of third-party artwork. The repository is not endorsed or certified by TMDB. Hero generation must use official TMDB artwork only; general web images, fan art, and AI-generated imagery are not permitted.

<img src="docs/tmdb-logo.svg" alt="The Movie Database (TMDB)" width="180">

**This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.**

The T2 compositor is adapted from [Prism Wallpapers](https://github.com/bramst0ne/prism-wallpapers), created by `bramst0ne`. Nuvio People gratefully acknowledges the original project and its author, who granted direct permission on 2026-08-06 to use, copy, modify, and publicly include the relevant code for this artwork workflow. Adapted source files retain their attribution notices.

No TMDB credential is stored in this repository. Metadata requests are made through a configured Cloudflare Worker; its TMDB bearer token remains a Cloudflare secret. Official TMDB image files are downloaded only from their public image host.

## Updating

The intended update model is selective and infrequent:

1. Every two months, audit people whose selected catalogue or presentation assets may have materially changed.
2. Regenerate only affected identities using deterministic selection and layout.
3. Run `npm run manifest` and `npm test`.
4. Review the exact output hashes before publishing.

Generated downloads, caches, contact sheets, and working files must remain outside the tracked asset tree. Do not rewrite unchanged binary assets: preserving their hashes keeps Git history and consumer caches efficient.

## Staging new People

New identities begin with the staging-only intake workflow documented in [`tools/people-intake/README.md`](tools/people-intake/README.md). It accepts explicit unregistered TMDB Person IDs and prepares the base poster/landscape, matching colour focus pair when a profile exists, V2 title logo, and T2 hero as one hash-bound review artifact. It cannot register or publish the identity; promotion remains a separate owner-approved step.

After review, the separate `Promote reviewed new People candidates` workflow can copy the exact approved artifact bytes into an isolated branch, extend `data/people.json` and the compact `data/people-intake-publications.json` evidence ledger, rebuild the manifest, validate the repository, and open a draft pull request. It cannot rerender artwork or merge its pull request. See the intake documentation for the approval record and safety checks.

## Legacy poster, landscape, and title-logo reproduction

The People-only base-artwork source record and offline renderer migrated from `nuvio-assets` are retained under `data/people-base/` and `tools/people-seed/`. The tool is staging-only, accepts at most 30 explicit Person IDs, and cannot access the network or publish assets. See [the decommission checklist](docs/people-workflow-decommission.md) before removing any legacy People paths from the old repository.

## Local validation

```bash
npm ci
npm test
```

To rebuild the deterministic inventory after an approved asset change:

```bash
npm run manifest
npm test
```

Validation enforces the registry-to-directory mapping, required assets, supported formats, approved hero dimensions, absence of unexpected files, and an up-to-date manifest. The 250 KiB hero size is a target rather than a rejection threshold.
