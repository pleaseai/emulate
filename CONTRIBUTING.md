# Contributing

Thanks for your interest in contributing! This guide covers how to get from a clone to a merged pull request.

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). All documentation, code, comments, and commit messages in this repository are written in **English**.

## Getting started

```bash
git clone https://github.com/pleaseai/emulate.git
cd emulate
mise install        # install pinned tool versions (bun + node)
bun install         # install dependencies
```

If you do not use [mise](https://mise.jdx.dev), any recent bun works — install it, then run `bun install`.

## Development workflow

1. Create a branch from `main` (e.g. `feat/short-description` or `fix/issue-123`).
2. Make focused changes — keep each pull request to one logical change.
3. Run the checks below and make sure they pass.
4. Open a pull request and fill out the template.

```bash
bun run lint        # lint and format (use lint:fix to auto-fix)
bun run type-check  # type-check all packages
bun run test        # run the test suite
bun run build       # ensure it builds

mise run ci         # or run lint + type-check + test + build in one step
```

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, where `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, etc. Breaking changes include a `BREAKING CHANGE:` footer. Versioning and the changelog are generated automatically from these messages (via release-please), so accurate types matter.

## Pull requests

- Reference the issue your PR addresses (e.g. `Closes #123`).
- Use a Conventional-Commit-style PR title — it becomes the squash-merge commit.
- Make sure CI is green before requesting review.

## Adding a new service

To add a new emulator, follow [docs/EMULATOR-CONVENTIONS.md](docs/EMULATOR-CONVENTIONS.md) to create a `packages/<service>/` package, then register it in `packages/emulate/src/registry.ts`.

## Reporting bugs and requesting features

Open an issue using the bug report or feature request template. For security
vulnerabilities, **do not** open a public issue — follow [SECURITY.md](./SECURITY.md).
