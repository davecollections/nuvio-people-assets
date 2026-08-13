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

## Review and promotion

Each staged artifact includes `reports/review-approval-template.json`. It is deliberately created with:

```json
"status": "owner-confirmation-required"
```

That template cannot be promoted. Review the visible artwork, canonical name, suggested actor/director membership, hero outcome, and exact output hashes first. Confirm or edit `categoryMembership`, combine the approved records when reviewing a batch, and explicitly change the top-level status to:

```json
"status": "owner-approved"
```

The approved document has this shape:

```json
{
  "version": "nuvio-new-person-review-approval-batch-v1",
  "status": "owner-approved",
  "approvals": [
    {
      "tmdbPersonId": 123456,
      "canonicalName": "Example Person",
      "categoryMembership": ["actor"],
      "candidateReportSha256": "64-lowercase-hex-characters",
      "heroSelectionSha256": "64-lowercase-hex-characters",
      "heroPresetId": "people-t2-perspective-v2",
      "destination": "assets/people/123456"
    }
  ]
}
```

Create an open issue for the reviewed batch, then manually run `Promote reviewed new People candidates` from `main` with:

- the successful staging workflow run ID;
- the open tracking issue number;
- the complete owner-approved JSON document.

The repository setting **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** must be enabled. The workflow checks this before downloading artifacts or creating a branch. Although GitHub combines creation and approval in one setting, this workflow only creates a draft pull request and contains no approval or merge command.

The promotion workflow accepts 1–30 approved identities and permits partial approval of a larger staged batch. It verifies that the staging run succeeded from `main`, came from the trusted staging workflow, and used a commit that remains in current `main`. It then verifies every approved identity, candidate-report hash, hero-selection hash, locked preset, destination, file set, output hash, byte count, format, and dimensions.

Only after all checks pass does it:

1. create an isolated `work/promote-new-people-*` branch;
2. copy the reviewed files byte-for-byte into `assets/people/{id}/`;
3. add the reviewed identity and categories to `data/people.json`;
4. add compact reproducibility evidence to `data/people-intake-publications.json`;
5. rebuild `manifests/people.json` and run the full test suite;
6. push the branch and open a draft pull request linked to the tracking issue.

Promotion makes no TMDB request, downloads no image, and performs no rendering. It never merges automatically. The owner must still review and explicitly approve the promotion pull request before the new URLs become live.

The full repository suite runs inside the promotion job against the exact promoted files before they are committed. GitHub normally suppresses a second automatic workflow run when its built-in Actions token creates the pull request, so the successful promotion run is the validation evidence attached to that draft PR.
