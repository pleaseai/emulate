# emulate docs

Documentation site for [pleaseai/emulate](https://github.com/pleaseai/emulate),
built with [Nimbus](https://nimbus-docs.com) (Cloudflare's docs framework on
Astro) and deployed to Cloudflare Pages.

**Live site: <https://emulate.pleaseai.dev>**

## Development

```bash
cd website
bun install
bun run dev        # http://localhost:4321
```

## Content sources

- `src/content/docs/guides/` and `reference/` — hand-written pages
- `src/content/docs/services/*.mdx` — **generated** from `../skills/<service>/SKILL.md`.
  Do not edit them directly; update the skill and regenerate:

```bash
bun run sync:services
```

The sidebar is built from the directory tree; each page's `sidebar.order`
frontmatter sets its position. Everything else under `src/` (layouts,
components, routes, styles) was scaffolded by Nimbus and can be edited freely. See
`AGENT.md` for Nimbus-specific guidance, and run `bunx @cloudflare/nimbus-docs outdated`
to see upstream template changes when upgrading `@cloudflare/nimbus-docs`.

## Checks

```bash
bun run typecheck  # astro check
bun run lint:docs  # nimbus-docs authoring lint
```

## Build & deploy

```bash
bun run build      # static output in dist/, including llms.txt and .md versions
bun run preview    # serve the build locally
```

Deployment targets a Cloudflare Pages project named `emulate`:

- **CI**: `.github/workflows/docs.yml` builds and deploys on pushes to `main`
  that touch `website/`, `skills/`, or `docs/`. Requires the
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **Manual**: `bun run deploy` (wrangler login required).
- **Git-integrated Pages** (alternative): set root directory `website`,
  build command `bun run sync:services && bun run build`, output `dist`.
