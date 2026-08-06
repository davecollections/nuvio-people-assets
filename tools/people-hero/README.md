# People hero generator

This staging-only tool creates deterministic People hero candidates using the `people-t2-perspective-v2` preset.

The T2 compositor is adapted with permission from [Prism Wallpapers](https://github.com/bramst0ne/prism-wallpapers). It consumes downloaded local image files and contains no credential or metadata-networking code.

Runtime configuration:

```text
PEOPLE_HERO_PROXY_URL=https://your-worker.example
PEOPLE_HERO_PROXY_TOKEN=<runtime secret, when service access is enabled>
```

Never put either value in a committed `.env` file. The proxy URL is not sensitive, but keeping it runtime-configurable avoids coupling this public asset repository to one deployment. The token must be a Cloudflare/GitHub secret and is never printed.

Current boundaries:

- explicit registered Person IDs only;
- all downloads, snapshots, and candidates remain in `.work`;
- official TMDB poster, backdrop, and profile paths only;
- filmography, profile-only, or skip outcomes under the locked thresholds;
- no direct TMDB metadata credential;
- no asset promotion, manifest update, commit, or push.

The manual `Stage one People hero` GitHub Actions workflow accepts one registered TMDB Person ID and uploads the ignored attempt directory as a seven-day artifact. It has read-only repository permission and cannot publish artwork.
