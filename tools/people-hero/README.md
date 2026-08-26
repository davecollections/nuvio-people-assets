# People hero generator

This staging-only tool creates deterministic People hero candidates using the `people-t2-perspective-v2` preset. When fewer than 15 eligible credits and fewer than 15 profiles exist, it uses every eligible credit poster in the same T2 lattice and applies the locked `people-t2-cinematic-defocus-fallback-v1` treatment. This avoids missing heroes without weakening credit eligibility.

The T2 compositor is adapted with permission from [Prism Wallpapers](https://github.com/bramst0ne/prism-wallpapers). It consumes downloaded local image files and contains no credential or metadata-networking code.

Runtime configuration:

```text
PEOPLE_HERO_PROXY_URL=https://your-worker.example
PEOPLE_HERO_PROXY_TOKEN=<runtime secret, when service access is enabled>
```

Never put either value in a committed `.env` file. The proxy URL is not sensitive, but keeping it runtime-configurable avoids coupling this public asset repository to one deployment. The token must be a Cloudflare/GitHub secret and is never printed.

Check one registered identity before downloading artwork:

```text
npm run people-hero:eligibility -- --person-id 2230991
```

This makes one proxy metadata request, requires no Python, downloads no images, and writes one compact result beneath `.work`. The result reports only counts, the chosen filmography/profile-only/skip outcome, and grouped rejection reasons; it does not retain a source snapshot or artwork paths.

Current boundaries:

- explicit registered Person IDs only;
- all downloads, snapshots, and candidates remain in `.work`;
- official TMDB poster, backdrop, and profile paths only;
- filmography, profile-only, sparse-fallback, or skip outcomes under the locked thresholds;
- sparse fallback is permitted only when at least one eligible official credit artwork source exists, never contains a baked-in title logo, and is automatically superseded once a normal hero becomes eligible;
- no direct TMDB metadata credential;
- no asset promotion, manifest update, commit, or push.

The manual `Stage one People hero` GitHub Actions workflow accepts one registered TMDB Person ID and uploads only the compact review evidence and candidate hero as a 30-day artifact. It has read-only repository permission and cannot publish artwork.

The manual `Stage People hero batch` workflow accepts an explicit comma- or whitespace-separated list of 1–30 registered Person IDs. One validated dispatch fans out isolated staging jobs with at most five running in parallel, keeps failures independent, and uploads one 30-day compact artifact per identity. It cannot infer the full registry, publish artwork, or update the manifest.

The manual `Check one People hero eligibility` workflow performs the compact metadata-only check with Node.js and uploads only its seven-day result. It does not install Python or download artwork.

## Bi-monthly refresh automation

`data/people-hero-refresh-state.json` records a complete deterministic baseline for every registered identity. The scheduled `Audit and stage People hero refreshes` workflow runs at 03:17 UTC on day 3 of February, April, June, August, October, and December, with its first scheduled run on 3 October 2026. It makes one metadata request per person in the normal case, with concurrency five and at most three attempts for temporary failures. If any identity remains unavailable, it stages nothing and uploads an incomplete report.

When the audit succeeds, it compares effective sources rather than scores. It stages a renderable outcome transition, one genuinely new credit entering the top eight, two changed filmography sources, or three changed profile-only paths. A score-only reorder is ignored, and a new skip outcome is reported without replacing the current hero. At most 30 deterministically prioritised candidates are rendered; overflow is listed without rendering. Explicit manual audits can force at most 30 registered IDs.

The same immutable audit snapshot is passed to generation, so staging makes no second metadata request. Artifacts retain only the candidate hero and compact review evidence for 30 days; downloaded source artwork remains ephemeral. Scheduled changes or failures create one focused tracking issue, while a no-change run creates none.

Local metadata-only commands are:

```text
npm run people-hero:refresh-audit -- --all
npm run people-hero:refresh-audit -- --person-ids 31,500 --force
```

All output remains below `.work`. These commands require the runtime proxy configuration and never publish assets.

After owner review, `Promote reviewed People hero refreshes` requires the trusted staging run ID, open issue, Person ID, exact destination, expected published hero hash, candidate/report/selection/snapshot hashes, and locked preset. Promotion accepts no more than 30 approvals, rejects altered or unexpected files, copies exact reviewed bytes without networking or rendering, updates the hero refresh state and manifest, runs `npm test`, and opens only a draft pull request from an isolated `work/` branch. It never merges, closes the issue, or removes branches.
