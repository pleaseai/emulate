import type { Options } from 'tsup'
import { readFile } from 'node:fs/promises'

// @emulators/core reads its inspector fonts with top-level readFileSync, which throws in workerd (#79).
// Bundling the helpers a service package uses, with that block made lazy, lets tree-shaking drop it.
const CORE_ENTRY = /@emulators[\\/]core[\\/]dist[\\/]index\.js$/

const REWRITES: Array<[string, string]> = [
  [
    'var __dirname = dirname(fileURLToPath(import.meta.url));',
    'var __dirname = () => dirname(fileURLToPath(import.meta.url));',
  ],
  [
    'readFileSync(join(__dirname, ',
    '/* @__PURE__ */ readFileSync(/* @__PURE__ */ join(/* @__PURE__ */ __dirname(), ',
  ],
]

const FORBIDDEN_IN_OUTPUT = ['readFileSync', 'fileURLToPath']

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number]

const lazyCoreFonts: EsbuildPlugin = {
  name: 'lazy-emulators-core-fonts',
  setup(build) {
    build.onLoad({ filter: CORE_ENTRY }, async (args) => {
      let contents = await readFile(args.path, 'utf8')
      for (const [from, to] of REWRITES) {
        if (!contents.includes(from)) {
          throw new Error(`@emulators/core font block changed; update scripts/tsup-inline-core.ts (missing: ${from})`)
        }
        contents = contents.replaceAll(from, to)
      }
      return { contents, loader: 'js' }
    })
    build.onEnd((result) => {
      for (const file of result.outputFiles ?? []) {
        if (!file.path.endsWith('.js')) {
          continue
        }
        const found = FORBIDDEN_IN_OUTPUT.filter(name => file.text.includes(name))
        if (found.length > 0) {
          throw new Error(`${file.path} still references ${found.join(', ')} from the @emulators/core font block`)
        }
      }
    })
  },
}

export const inlineEmulatorsCore = {
  noExternal: ['@emulators/core'],
  esbuildPlugins: [lazyCoreFonts],
} satisfies Options
