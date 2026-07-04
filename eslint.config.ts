import pleaseai from '@pleaseai/eslint-config'

export default pleaseai(
  {
    ignores: ['docs/**', 'website/src/content/**', 'website/.astro/**', 'website/dist/**'],
  },
  {
    // The CLI legitimately prints to stdout.
    files: ['packages/emulate/src/index.ts', 'packages/emulate/src/commands/**', 'packages/emulate/src/portless.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
