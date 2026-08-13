# New People intake

This staging-only workflow prepares one complete, reviewable artwork set for a TMDB Person ID that is not yet registered in `data/people.json`.

It reuses the approved People renderers and produces:

- monochrome `poster.webp` and compatibility `landscape.webp`;
- a matching quality-82 colour focus pair when an official profile is available;
- the approved standard-canvas V2 `title-logo.png`;
- the locked T2 `hero.webp` when the normal or sparse hero policy finds eligible artwork;
- a suggested actor/director category for owner review;
- source, request, renderer, output, and SHA-256 evidence.

All files remain below `tools/people-intake/.work/`. The tool cannot update the canonical registry, write to `assets/people`, rebuild the manifest, commit, push, or publish anything.

Runtime configuration uses the same Cloudflare proxy boundary as the hero generator:

```text
PEOPLE_HERO_PROXY_URL=https://your-worker.example
PEOPLE_HERO_PROXY_TOKEN=<runtime secret, when service access is enabled>
```

Stage one unregistered identity locally:

```powershell
npm run people-intake:stage -- --person-id 123456
```

The manual `Stage new People artwork set` GitHub Action accepts 1–30 explicit unregistered IDs and uploads one isolated seven-day artifact per identity. Generation is not publication: the reviewed candidate hashes must be promoted in a separate owner-approved change.
