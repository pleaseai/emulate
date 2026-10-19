import nimbus, { defineConfig as defineNimbusConfig } from '@cloudflare/nimbus-docs'
import { tableScroll } from '@cloudflare/nimbus-docs/markdown'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const nimbusConfig = defineNimbusConfig({
  site: 'https://emulate.pleaseai.dev',
  title: 'emulate',
  description:
    'Local drop-in replacement services for CI and no-network sandboxes. Fully stateful, production-fidelity API emulation.',
  locale: 'en',
  github: 'https://github.com/pleaseai/emulate',
  editPattern: 'https://github.com/pleaseai/emulate/edit/main/website/{path}',
  socialImageAlt: 'emulate documentation preview',
  sidebar: {
    items: [
      { label: 'Guides', autogenerate: { directory: 'guides' } },
      { label: 'Services', autogenerate: { directory: 'services' } },
      { label: 'Reference', autogenerate: { directory: 'reference' } },
    ],
  },
})

export default defineConfig({
  // nimbus:adapter
  output: 'static',
  // Tailwind v4 via its Vite plugin (the PostCSS plugin doesn't build under
  // Astro 7's Vite 8 bundler).
  vite: {
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  integrations: [
    nimbus(nimbusConfig, {
      rules: {
        'nimbus/frontmatter-shape': 'error',
        'nimbus/internal-link': 'error',
      },
      markdown: {
        // Wrap wide tables so they scroll instead of overflowing the page
        // (styled by `.nb-table-scroll` in src/styles/prose.css).
        hastPlugins: [tableScroll()],
      },
    }),
  ],
})
