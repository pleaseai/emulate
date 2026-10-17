import pleaseai from '@pleaseai/eslint-config'

export default pleaseai(
  {
    // website/src is scaffolded by Nimbus; keeping its upstream style lets
    // `nimbus-docs diff --apply` upgrades apply cleanly.
    ignores: ['docs/**', 'website/src/**', 'website/.astro/**', 'website/dist/**', 'website/AGENT.md', 'website/CLAUDE.md'],
  },
  {
    // The CLI legitimately prints to stdout.
    files: ['packages/emulate/src/index.ts', 'packages/emulate/src/commands/**', 'packages/emulate/src/portless.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
