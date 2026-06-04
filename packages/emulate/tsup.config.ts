import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/api.ts'],
  format: ['esm'],
  // tsup injects a deprecated `baseUrl` into the dts build; silence it under TS 6
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
})
