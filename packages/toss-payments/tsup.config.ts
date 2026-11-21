import { defineConfig } from 'tsup'
import { inlineEmulatorsCore } from '../../scripts/tsup-inline-core'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  ...inlineEmulatorsCore,
  // tsup injects a deprecated `baseUrl` into the dts build; silence it under TS 6
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
})
