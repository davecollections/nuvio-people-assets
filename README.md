# Nuvio People Assets

Public artwork assets for People collections in Nuvio.

Each person has a stable, TMDB-ID-based directory:

```text
assets/people/{tmdb_person_id}/
  poster.webp
  title-logo.png
  landscape.webp   # retained for current/V1 compatibility
  hero.webp        # filmography hero, added as it is approved
```

For example, Tom Hanks is stored under `assets/people/31/`.

## Asset contract

- `poster.webp` and `title-logo.png` are required for every registry entry.
- `landscape.webp` is currently retained, but is considered a legacy/compatibility asset while the V2 presentation options are finalised.
- `hero.webp` is optional during rollout. Approved heroes use the `people-filmography-t2-perspective-24-v1` design: 1920 x 1080, 24 credited titles, T2 perspective layout, WebP quality 82.
- Paths are identity-based and must not be renamed when a person's display name changes.
- `manifests/people.json` is the canonical machine-readable inventory, including SHA-256 hashes, dimensions, byte counts, and direct raw GitHub URLs.

Consumers may use the stable `main` URLs and compare manifest hashes when deciding whether to refresh cached artwork.

## Source and rights

People imagery and film/TV artwork originate from TMDB. This repository does not claim ownership of third-party artwork. The repository is not endorsed or certified by TMDB. Hero generation must use official TMDB artwork only; general web images, fan art, and AI-generated imagery are not permitted.

## Updating

The intended update model is selective and infrequent:

1. Audit people whose credited catalogue or presentation asset has materially changed.
2. Regenerate only affected identities using deterministic selection and layout.
3. Run `npm run manifest` and `npm test`.
4. Review the exact output hashes before publishing.

Generated downloads, caches, contact sheets, and working files must remain outside the tracked asset tree. Do not rewrite unchanged binary assets: preserving their hashes keeps Git history and consumer caches efficient.

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

Validation enforces the registry-to-directory mapping, required assets, supported formats, hero dimensions and size budget, absence of unexpected files, and an up-to-date manifest.
