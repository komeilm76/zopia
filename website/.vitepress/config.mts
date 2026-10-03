import { defineConfig } from 'vitepress';

/**
 * zopia documentation website.
 *
 * Deployed to the public `komeilm76/komeilm76.github.io` repository under
 * `/zopia/`, so `base` must stay `/zopia/` — see
 * `docs/development/14-website.md`.
 */
export default defineConfig({
  base: '/zopia/',
  srcDir: 'src',
  lang: 'en-US',
  title: 'zopia',
  titleTemplate: ':title · zopia',
  description: 'Type-safe OpenAPI, JSON Schema, and Zod conversion toolkit.',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,
  srcExclude: ['**/README.md'],

  head: [
    ['meta', { name: 'theme-color', content: '#6d5efc' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'zopia — type-safe OpenAPI ↔ Zod toolkit' }],
    ['meta', { property: 'og:description', content: 'Generate type-safe endpoint code from OpenAPI, and regenerate the spec from the code.' }],
    ['meta', { property: 'og:url', content: 'https://komeilm76.github.io/zopia/' }],
  ],

  markdown: {
    lineNumbers: false,
    theme: { light: 'github-light', dark: 'github-dark' },
  },

  vite: {
    server: {
      host: '0.0.0.0',
      // The sandboxed live preview is proxied through an arbitrary host name.
      allowedHosts: true,
    },
  },

  themeConfig: {
    logo: undefined,
    siteTitle: 'zopia',

    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/conversions', activeMatch: '/reference/' },
      { text: 'Changelog', link: '/changelog' },
      {
        text: 'v0.6',
        items: [
          { text: 'v0.6 (latest)', link: '/' },
          { text: 'Release notes', link: '/changelog' },
          { text: 'All releases on GitHub', link: 'https://github.com/komeilm76/zopia/releases' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          collapsed: false,
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quick start', link: '/guide/quick-start' },
          ],
        },
        {
          text: 'Using zopia',
          collapsed: false,
          items: [
            { text: 'CLI reference', link: '/guide/cli' },
            { text: 'Programmatic API', link: '/guide/programmatic-api' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Runtime', link: '/guide/runtime' },
          ],
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Conversions', link: '/reference/conversions' },
            { text: 'API docs format', link: '/reference/api-docs-format' },
            { text: 'Components', link: '/reference/components' },
            { text: 'Errors & warnings', link: '/reference/errors-and-warnings' },
            { text: 'Concepts', link: '/reference/concepts' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Conversions', link: '/reference/conversions' },
            { text: 'API docs format', link: '/reference/api-docs-format' },
            { text: 'Components', link: '/reference/components' },
            { text: 'Errors & warnings', link: '/reference/errors-and-warnings' },
            { text: 'Concepts', link: '/reference/concepts' },
          ],
        },
        {
          text: 'Guide',
          collapsed: true,
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Quick start', link: '/guide/quick-start' },
            { text: 'CLI reference', link: '/guide/cli' },
            { text: 'Programmatic API', link: '/guide/programmatic-api' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Runtime', link: '/guide/runtime' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/komeilm76/zopia' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/zopia' },
    ],

    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },

    editLink: {
      pattern: 'https://github.com/komeilm76/zopia/edit/main/docs/user/:path',
      text: 'Suggest changes to this page',
    },

    outline: { level: [2, 3], label: 'On this page' },

    docFooter: { prev: 'Previous', next: 'Next' },

    footer: {
      message: 'Released under the MIT License · Documentation generated from <code>docs/user/</code>',
      copyright: `© ${new Date().getFullYear()} komeilm76`,
    },
  },
});
