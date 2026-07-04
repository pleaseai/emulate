// @ts-check
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://emulate.pleaseai.dev',
  integrations: [
    starlight({
      title: 'emulate',
      description:
        'Local drop-in replacement services for CI and no-network sandboxes. Fully stateful, production-fidelity API emulation.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/pleaseai/emulate' },
      ],
      editLink: {
        baseUrl: 'https://github.com/pleaseai/emulate/edit/main/website/',
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting Started', slug: 'guides/getting-started' },
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Programmatic API', slug: 'guides/programmatic-api' },
            { label: 'Authentication', slug: 'guides/authentication' },
          ],
        },
        {
          label: 'Services',
          autogenerate: { directory: 'services' },
        },
        {
          label: 'Reference',
          items: [
            { label: 'Architecture', slug: 'reference/architecture' },
            { label: 'Emulator Conventions', slug: 'reference/conventions' },
          ],
        },
      ],
    }),
  ],
})
