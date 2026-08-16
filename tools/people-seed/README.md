# People base-artwork reproduction tool

This is the migrated, People-only subset of the original `nuvio-assets` People renderer. For the frozen original 1,480 identities, it reproduces the current 1000 x 1500 poster, current 1200 x 675 compatibility landscape, current 1600 x 480 V2 title logo, and the historical 1863 x 673 title logo retained as migration evidence.

The tool is intentionally narrower than the historical workflow:

- it accepts 1–30 explicit registered TMDB Person IDs;
- it reads only local source caches and makes zero network requests;
- it verifies portrait bytes against the migrated source record;
- it uses the exact locked Sharp, libvips, Skia Canvas, Pango, presets, and OFL font input;
- it writes only beneath the ignored `tools/people-seed/.work/` directory;
- it compares the poster, landscape, and V2 title-logo hashes with current published assets while independently verifying the frozen legacy title-logo evidence;
- it cannot publish assets, rebuild the canonical manifest, commit, or push.

Example using an existing offline cache:

```powershell
npm run people-base:stage -- --person-id 1 --source-cache C:\path\to\people-source-cache
```

Repeat `--source-cache` when the selected identities are stored in different historical caches. Cache indexes must use the original `people-portrait-source-cache-v1` contract.

Before retiring an old local workspace, consolidate every exact approved portrait source into this repository's ignored workspace:

```powershell
npm run people-base:consolidate-sources -- --source-cache C:\path\to\first-cache --source-cache C:\path\to\second-cache
```

The command validates every non-fallback source hash, requires both repositories to be on the same hard-link-capable volume, and refuses to replace an existing migrated cache. It fails closed rather than silently copying gigabytes of source artwork.

The original studio/network batch is not part of this tool and remains owned by `nuvio-assets`.

## Title-logo standard-canvas v2

Issue #37 contains the owner-approved design lock for the current title-logo renderer. It uses a standard 1600 x 480 transparent canvas, one fixed 150 px uppercase Cormorant person-name size, and one uniform open-clapboard, split-rule, and `COLLECTION` block across every identity. The approved secondary treatment is 5% larger than the earlier six-person proof: a 700 x 50 separator and 97.65 px `COLLECTION` text. When a two-line name is at most a few pixels too tall because of its exact glyph bounds, only the visible inter-line gap is compacted, never the 150 px font size, and at least 2 px of visible separation must remain.

The exact original 1,480 V2 outputs were separately owner-approved and published under issue #37; `data/people-base/title-logo-v2-publication.json` binds those production hashes. The reusable renderer deliberately retains `publicationAuthorised: false`: it can reproduce or stage the approved design, but it cannot publish or replace catalogue assets by itself. Later new identities receive the same V2 design through the reviewed People intake workflow.

Generate a narrow local proof set with explicit registered identities:

```powershell
npm run people-title-logo:v2-proof -- --person-id 31,1922
```

The command makes no network requests or downloads and writes only beneath the ignored `tools/people-seed/.work/title-logo-v2-proof/` directory. Separate review and explicit owner approval are required before replacing any `assets/people/{id}/title-logo.png` file.
