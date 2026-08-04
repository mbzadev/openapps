// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

const SITE = process.env.DOCS_SITE_URL || 'https://apps.mbza.dev'
const BASE = process.env.DOCS_SITE_BASE || '/docs'
const REPO = 'https://github.com/mbzadev/openapps'

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'never',
  // The installation page IS the docs homepage now. Anyone arriving at the
  // old URL gets pushed to the root.
  redirects: {
    '/getting-started/installation': '/',
  },
  integrations: [
    starlight({
      title: 'OpenApps',
      description:
        'Cloudflare-native App Store and Google Play intelligence with a 29-tool MCP server.',
      logo: {
        light: './src/assets/logo.svg',
        dark: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: '/favicon.ico',
      social: [
        { icon: 'github', label: 'GitHub', href: REPO },
      ],
      editLink: {
        baseUrl: `${REPO}/edit/main/docs-site/`,
      },
      lastUpdated: true,
      pagination: true,
      customCss: ['./src/styles/theme.css'],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#10b981' },
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: `${SITE}${BASE}/og.png`,
          },
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            // Installation is the docs homepage (slug is '').
            { label: 'Installation', slug: '' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', slug: 'architecture/overview' },
          ],
        },
        {
          label: 'MCP',
          items: [
            {
              label: 'MCP Server',
              slug: 'services/mcp',
              badge: { text: 'AI', variant: 'success' },
            },
          ],
        },
        {
          label: 'API',
          items: [
            { label: 'Endpoints', slug: 'api/endpoints' },
            { label: 'Authentication', slug: 'api/authentication' },
          ],
        },
        {
          label: 'Deployment',
          items: [
            { label: 'Cloudflare', slug: 'deployment/cloudflare' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Environment Variables', slug: 'reference/environment-variables' },
          ],
        },
      ],
    }),
  ],
})
