# People hero generator architecture

## Locked outcome

The generator is a staging-first, deterministic People-only workflow. It produces 2560 x 1440 T2 perspective WebP candidates at quality 82 without modifying published assets or the canonical manifest.

For each registered TMDB Person ID it chooses exactly one outcome:

1. **Filmography:** select 15–32 eligible, distinct credits. Use more than 24 only when the career supports a denser unique-title composition. Use posters and backdrops first; add at most three profiles only when portrait positions would otherwise remain empty. The approved full-bleed Prism T2 lattice places every selected source first, then uses deterministic lower-salience fallback placements only where required to prevent exposed perspective/bleed slots.
2. **Profile-only:** when fewer than 15 credits qualify but 15–24 suitable official profiles exist, use the portrait-focused T2 layout with no credit artwork.
3. **Skip:** when neither threshold is met.

The 250 KiB output size is an optimisation target, not a failure condition. The repository-wide 1 MiB asset ceiling remains mandatory.

## Rights and attribution

The T2 compositor is adapted from `bramst0ne/prism-wallpapers`. The project author directly granted permission on 2026-08-06 to use, copy, modify, and publicly include the relevant code for this workflow. Vendored derived files retain an attribution header and the repository README links to the original project. The unused HazedNapkin fork is not a source dependency.

## Credential boundary

No TMDB API key or bearer token may enter this repository at any stage. The generator requests metadata through a configured Cloudflare Worker. The Worker retains `TMDB_BEARER_TOKEN` as its own secret.

For non-browser callers, the Worker will require a separate service-access value. The People generator reads that value only from `PEOPLE_HERO_PROXY_TOKEN`; GitHub Actions supplies it through a repository secret. The value must never be accepted as a CLI argument, written to URLs, logged, cached, or included in evidence. The public Worker origin is supplied through `PEOPLE_HERO_PROXY_URL`.

The vendored compositor has no network or credential code. It receives a local source plan and local image paths. Official artwork bytes are downloaded separately from TMDB's public image host into the ignored workspace.

## Selection policy

Eligible records are genuine movie/TV acting credits and exact `Director` crew credits. A tracked owner-approved override can additionally admit an exact person/media/job creative crew credit when a directing career would otherwise fall below the filmography minimum; this does not admit that job globally. Reject adult or blocked media, self/himself/herself roles, archive footage, uncredited work, characters matching the person's name, unrelated crew work, duplicates, individual TV episodes, and records without a usable official poster or backdrop.

One-episode TV cast roles are rejected by default. A small tracked exception map can admit a culturally significant role. Parent shows are deduplicated by `(mediaType, mediaId)`.

Ranking is deterministic and career-oriented. Role significance is considered before TMDB popularity, vote support, and artwork suitability. Stable media type, media ID, and artwork-path tie-breaks complete the ordering. Identical inputs must select and render identical bytes under the same locked runtime.

## Staging and publication

Every operation accepts exactly one registered Person ID and writes only beneath `tools/people-hero/.work`. The lightweight eligibility check makes one metadata request and retains only a compact deterministic summary of counts, outcome, and grouped rejection reasons; it downloads no artwork and stores no source paths. A full candidate-generation run separately records the source snapshot, accepted and rejected credits, ranking components, selected paths, profiles, layout seed, renderer version, and hashes without credentials.

Generation has no code path to `assets/people`. Promotion remains a separate future command requiring explicit owner approval of the exact Person ID and candidate SHA-256. No branch, commit, push, or publication occurs automatically.

## Refresh policy

The scheduled audit cadence is every two months. A candidate is staged when at least two selected titles/artwork paths change, one new credit enters the top eight, or a manual refresh is requested. Profile-only heroes require at least three changed selected profiles unless manually refreshed. Score-only changes that leave the effective selection and artwork unchanged do not trigger a render.
