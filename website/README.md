# emulate docs

Documentation site for [pleaseai/emulate](https://github.com/pleaseai/emulate),
built with [Astro Starlight](https://starlight.astro.build) and deployed to
Cloudflare Pages.

## Development

```bash
cd website
bun install
bun run dev        # http://localhost:4321
```

## Content sources

- `src/content/docs/guides/` and `reference/` — hand-written pages
- `src/content/docs/services/*.md` — **generated** from `../skills/<service>/SKILL.md`.
  Do not edit them directly; update the skill and regenerate:

```bash
bun run sync:services
```

## Build & deploy

```bash
bun run build      # static output in dist/
bun run preview    # serve the build locally
```

Deployment targets a Cloudflare Pages project named `emulate-docs`:

- **CI**: `.github/workflows/docs.yml` builds and deploys on pushes to `main`
  that touch `website/`, `skills/`, or `docs/`. Requires the
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **Manual**: `bun run deploy` (wrangler login required).
- **Git-integrated Pages** (alternative): set root directory `website`,
  build command `bun run sync:services && bun run build`, output `dist`.
