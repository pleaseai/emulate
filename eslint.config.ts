import pleaseai from '@pleaseai/eslint-config'

export default pleaseai(
  {
    ignores: ['docs/**', 'website/src/content/**', 'website/.astro/**', 'website/dist/**'],
  },
  {
    // The CLI legitimately prints to stdout.
    files: ['packages/emulate/src/index.ts', 'packages/emulate/src/commands/**'],
    rules: {
      'no-console': 'off',
    },
  },
)
