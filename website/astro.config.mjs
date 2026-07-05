// @ts-check
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightThemeBlack from 'starlight-theme-black'

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
      plugins: [
        starlightThemeBlack({
          navLinks: [{ label: 'Docs', link: '/guides/getting-started/' }],
          footerText:
            'Built by [PleaseAI](https://github.com/pleaseai). Based on [vercel-labs/emulate](https://github.com/vercel-labs/emulate). Licensed Apache-2.0.',
        }),
      ],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting Started', slug: 'guides/getting-started' },
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Programmatic API', slug: 'guides/programmatic-api' },
            { label: 'Authentication', slug: 'guides/authentication' },
            { label: 'HTTPS with portless', slug: 'guides/portless' },
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
