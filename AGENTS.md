# Nuvio People assets repository instructions

## Repository purpose

This repository is the canonical public source for Nuvio People artwork and People-specific generation tooling. Keep it focused on People identities, manifests, validation, title-logo work, and filmography hero generation.

Do not add company, network, genre, popular, new, or trending generation here. Generic collection artwork and compatibility assets outside the per-person tree remain the responsibility of `nuvio-assets` until an explicit migration is approved.

## GitHub workflow

- Use one focused GitHub issue and a dedicated `work/` branch for every meaningful repository change.
- Do not work directly on `main`, merge a pull request, close an issue, or delete a branch without explicit owner approval.
- Push reviewed implementation work to its branch and open a draft pull request by default.
- Keep each pull request limited to its tracking issue and report tests, production impact, asset writes, and remaining review steps.
- Read-only investigation and local discussion do not require an issue or branch.

## Identity and asset contract

Each published identity uses its numeric TMDB Person ID:

```text
assets/people/{tmdb_person_id}/
  poster.webp       # required
  title-logo.png    # required
  landscape.webp    # retained compatibility asset
  hero.webp         # optional during controlled rollout
  focus-poster.webp      # optional static colour focus counterpart
  focus-landscape.webp   # optional static colour focus counterpart
```

- A display-name change must never rename the directory or public URL.
- Each identity must retain its own physical files; do not replace identity-specific assets with aliases or shared files.
- Do not delete existing landscapes. They remain legacy/current compatibility assets pending a separate V2 decision.
- Do not regenerate the catalogue-wide title-logo set as part of hero-generator work.
- Do not modify published assets unless the user explicitly approves that asset change.
- Focus artwork must be published as a poster/landscape pair. It uses the same approved source, crop, gradients, grain, and person-name typography as the monochrome base artwork, with only the grayscale and warm-tint treatment removed. The controlled preset is static WebP quality 82 at 1000 x 1500 and 1200 x 675; catalogue-wide promotion requires separate explicit approval after the Nuvio focus proof.

## Locked People hero preset

The approved new-generation preset is `people-t2-perspective-v2`:

- 2560 x 1440 WebP, quality 82;
- 250 KiB is a target, not a hard rejection threshold;
- 15–32 eligible distinct movie/TV credits for a filmography hero, using more only when the career supports a denser unique-title layout;
- a profile-only hero with 15–24 distinct official TMDB profiles when fewer than 15 credits qualify;
- at most three official profiles may fill otherwise-empty portrait positions in a filmography hero;
- perspective T2 composition, concentrated centre-right and right;
- dark, clean left title-safe zone;
- no title logo baked into the hero;
- premium mixed poster/backdrop presentation without stretching or a flat poster-grid appearance;
- approved full-bleed Prism T2 lattice, placing every distinct selected source before any deterministic coverage fallback; repeated placements are permitted only when needed to prevent exposed perspective/bleed slots and should remain in lower-salience positions where possible;
- official TMDB poster, backdrop, and permitted profile artwork only.

Do not generate alternate T1, flat, or 36/60-title variants unless the user explicitly reopens design testing. Profile-only heroes retain the T2 perspective but use portrait tiles rather than severely cropping headshots into landscape tiles. Do not use general web images, fan art, AI imagery, or Fanart.tv artwork for People heroes.

## Source selection and determinism

People heroes may use genuine cast credits and exact `Director` credits across movies and TV. A tracked, owner-approved exception may admit an exact person/media/job creative crew credit when a directing career otherwise falls below the filmography minimum; these exceptions must remain person-bound and must not globally admit writer or producer work. A principal-performer concert or performance film may retain a `Self` or own-name cast credit only when TMDB classifies it as a movie in Music genre `10402` and bills the person at order `0`. Exclude all other self appearances, adult/blocked records, archive/uncredited appearances, characters matching the person, unrelated credits, records without usable official artwork, and duplicate media identities. Exclude one-episode TV roles by default unless a tracked exception marks the role as culturally significant. Ranking must represent the person's career using role significance, popularity, vote support, and artwork suitability; it must not simply take the first or most-popular API records up to the layout cap.

Every selection and render decision must be deterministic. Define stable tie-breaks and route all pseudo-random choices through one explicitly seeded generator. The reproducibility record must bind at least:

- preset and renderer version;
- TMDB Person ID;
- selected media type and media ID in stable order;
- selected poster/backdrop paths;
- selection scores and tie-break fields;
- derived seed and layout decisions;
- output encoding settings and final SHA-256.

An unchanged source snapshot and runtime lock must reproduce the same output bytes. If exact byte reproducibility cannot be guaranteed across runtime versions, fail closed and require a reviewed renderer-version change.

## Staging and publication boundary

All network access, downloads, caches, source artwork, reports, contact sheets, previews, and candidate renders must stay below an ignored tool workspace such as:

```text
tools/people-hero/.work/
  cache/
  downloads/
  staging/
  reports/
  contact-sheets/
  previews/
  reviews/
```

- Never delete or recreate ignored audit or staging workspaces without explicit approval.
- Generation is staging-only by default and must process the narrowest explicitly selected identity set.
- Never run a blind or automatic 1,480-person batch.
- Do not write directly to `assets/people`, rebuild the canonical manifest, commit, or push during generation/review.
- Promotion requires explicit user approval bound to the reviewed candidate SHA-256, Person ID, preset version, source-selection record, and exact destination.
- Before promotion, compare the candidate SHA-256 with the published hero and skip unchanged bytes.
- After an approved promotion, rebuild `manifests/people.json`, run `npm test`, and report every changed, unchanged, skipped, and failed identity.

## Validation and storage rules

The current validator is authoritative. In particular:

- every asset must decode to its filename's expected format;
- every individual asset must remain below 1 MiB;
- focus posters must be exactly 1000 x 1500 and focus landscapes exactly 1200 x 675, with neither file permitted on its own;
- legacy published heroes may remain 1920 x 1080 until individually replaced; all newly promoted heroes must be exactly 2560 x 1440;
- the repository-wide 1 MiB ceiling remains mandatory, while 250 KiB is only the hero optimisation target;
- no unexpected files may appear in identity directories;
- `manifests/people.json` must match a fresh deterministic inventory build.

Do not use Git LFS for public runtime assets. Do not rewrite unchanged binaries. Commit only approved runtime assets and compact reproducibility/source metadata; keep bulky working evidence ignored.

## Related repositories and prototypes

Treat `C:\Users\Dave\Documents\GitHub\nuvio-assets` as read-only unless the user explicitly places it in write scope. Preserve its branch, uncommitted rejected profile-collage POC, and ignored profile audit. Do not clean, reset, delete, switch branches, or publish there from this project.

Treat `C:\Users\Dave\Documents\Artwork_tool\prism-wallpapers-main` as the local reference implementation. Never read, copy, expose, or commit its `.env` or any credential. The Prism author granted direct permission on 2026-08-06 to use, copy, modify, and publicly include the relevant code. Vendor only the compositor code required by this People workflow, retain clear attribution, and remove all credential loading and direct TMDB metadata access from the vendored renderer.

The current approved local prototype is preferred over switching to the GUI fork because it produced the reviewed Tom Hanks and Blake Edwards proofs. The GUI fork may be used as reference or a manual alternative, but its current People mode mixes tagged-person images with cast credits, can resolve Fanart.tv artwork, and contains unseeded global randomness. Do not adopt those behaviours for Nuvio People.

TMDB credentials must never exist in tracked code, committed configuration, URLs, logs, reports, fixtures, or generated metadata. Metadata acquisition must use the configured Cloudflare proxy. A proxy service-access token may be supplied only at runtime through an environment variable or GitHub secret. Do not migrate secrets from the external tool or read its `.env`.

## Required preflight

Before changing code or generating a proof:

1. Read this file and the repository README.
2. Inspect `git status --short`, the current branch, recent history, and all relevant uncommitted diffs.
3. Run `npm test` and preserve the baseline result.
4. Inspect existing ignored staging/review evidence for the selected identity; do not recreate completed work from assumptions.
5. Confirm the operation is People-only, staging-first, and uses the narrowest selected ID set.
6. Confirm no credential value or `.env` content can enter logs, reports, fixtures, or tracked files.

## Response expectations

For implementation, generation, or promotion work, report:

- preflight branch and working-tree state;
- files changed;
- tests and validation run;
- exact Person IDs selected;
- API requests and downloads performed;
- candidates generated, unchanged, skipped, or failed;
- permanent asset and manifest writes, including old/new hashes;
- final `git status --short`.

Do not create a branch, commit, push, or pull request unless the user explicitly requests publication work.
