# People hero generator architecture

## Locked outcome

The generator is a staging-first, deterministic People-only workflow. It produces 2560 x 1440 T2 perspective WebP candidates at quality 82 without modifying published assets or the canonical manifest.

For each registered TMDB Person ID it chooses exactly one outcome:

1. **Filmography:** select 15–32 eligible, distinct credits. Use more than 24 only when the career supports a denser unique-title composition. Use posters and backdrops first; add at most three profiles only when portrait positions would otherwise remain empty. The approved full-bleed Prism T2 lattice places every selected source first, then uses deterministic lower-salience fallback placements only where required to prevent exposed perspective/bleed slots.
2. **Profile-only:** when fewer than 15 credits qualify but 15–24 suitable official profiles exist, use the portrait-focused T2 layout with no credit artwork.
3. **Sparse fallback:** when neither normal threshold is met but at least one eligible credit has official artwork, use every eligible credit in the same T2 lattice and apply the locked cinematic defocus and dark grading. This conceals unavoidable repetition without admitting excluded credits or baking the separate title logo into the hero. A later refresh automatically replaces the fallback when a normal hero becomes eligible.
4. **Skip:** when the profile-only threshold is not met and no eligible credit artwork exists.

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

The public hero CLI remains registry-bound and writes only beneath `tools/people-hero/.work`. The manual single-identity workflows accept exactly one registered Person ID, while the controlled batch workflow accepts an explicit bounded list of registered IDs. The lightweight eligibility check makes one metadata request and retains only a compact deterministic summary of counts, outcome, and grouped rejection reasons; it downloads no artwork and stores no source paths. A full candidate-generation run separately records the source snapshot, accepted and rejected credits, ranking components, selected paths, profiles, layout seed, renderer version, and hashes without credentials.

Generation has no code path to `assets/people`. The separate new-People intake can stage explicit unregistered IDs and has an implemented owner-approved promotion workflow: it verifies the reviewed hashes, copies the exact candidate bytes, updates the registry, refresh state, and manifest on an isolated branch, and opens a draft pull request without merging. Registered-hero promotion is also a separate manual workflow: it trusts only successful `main` staging runs, verifies the open tracking issue and exact owner-approved hashes, copies only reviewed hero bytes, updates the refresh state and manifest, validates the repository, and opens a draft pull request. No generation workflow publishes or merges automatically.

## Active refresh policy

The scheduled audit runs at 03:17 UTC on day 3 of every even-numbered month. It reads the complete deterministic baseline in `data/people-hero-refresh-state.json`, requests one combined metadata snapshot per registered identity with concurrency five and bounded retries, and downloads no image unless that identity passes a material-change threshold. If any identity remains unavailable, the run fails closed, uploads its incomplete report, and stages nothing.

A candidate is staged for any transition between renderable outcomes, one genuinely new credit entering the current top eight, or at least two selected credit/artwork sources being added, removed, replaced, or changing effective artwork path. Profile-only heroes require at least three changed selected profile paths. Score-only reordering of the same sources does not render. A new skip outcome keeps the published hero and is reported for attention. Explicit forced runs may bypass these thresholds for up to 30 registered IDs.

Qualifying candidates are ordered deterministically, capped at 30, and rendered from the exact audit snapshot without a second metadata request. Sparse-fallback upgrades receive highest priority, followed by new top-eight credits, other outcome changes, material-change count, and TMDB Person ID. Overflow is reported without rendering. Only compact evidence and the candidate hero are retained for 30 days; source downloads remain ephemeral.

The audit opens no issue when nothing changed. Changes, attention cases, overflow, staging failures, or metadata failures are recorded in one focused tracking issue. Neither audit nor staging can create a publication branch or pull request. The separate promotion workflow requires an exact hash-bound owner approval, rejects stale published/state hashes and unexpected files, and performs no metadata access, image download, or rerendering.
