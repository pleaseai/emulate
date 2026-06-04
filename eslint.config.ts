import pleaseai from '@pleaseai/eslint-config'

export default pleaseai(
  {
    ignores: ['docs/**'],
  },
  {
    // The CLI legitimately prints to stdout.
    files: ['packages/emulate/src/index.ts', 'packages/emulate/src/commands/**'],
    rules: {
      'no-console': 'off',
    },
  },
)
