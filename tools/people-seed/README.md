# People base-artwork reproduction tool

This is the migrated, People-only subset of the original `nuvio-assets` People renderer. It reproduces the current 1000 x 1500 poster, 1200 x 675 compatibility landscape, and 1863 x 673 transparent title logo.

The tool is intentionally narrower than the historical workflow:

- it accepts 1–30 explicit registered TMDB Person IDs;
- it reads only local source caches and makes zero network requests;
- it verifies portrait bytes against the migrated source record;
- it uses the exact locked Sharp, libvips, Skia Canvas, Pango, presets, and OFL font input;
- it writes only beneath the ignored `tools/people-seed/.work/` directory;
- it compares generated hashes with the current published assets and fails closed on drift;
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

Issue #37 contains the owner-approved design lock for the staging-only successor to the current title-logo renderer. It uses a standard 1600 x 480 transparent canvas, adaptively fits only the uppercase Cormorant person name, and keeps one uniform open-clapboard, split-rule, and `COLLECTION` block across every identity. The preset is design-locked but remains publication-disabled, so it cannot by itself change any catalogue asset.

Generate a narrow local proof set with explicit registered identities:

```powershell
npm run people-title-logo:v2-proof -- --person-id 31,1922
```

The command makes no network requests or downloads and writes only beneath the ignored `tools/people-seed/.work/title-logo-v2-proof/` directory. Separate review and explicit owner approval are required before replacing any `assets/people/{id}/title-logo.png` file.
