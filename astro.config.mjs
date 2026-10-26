import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { postAssets } from './src/integrations/assets.js';

export default defineConfig({
  site: 'https://kukudelin.top',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => !/\/page\/\d+\/$/.test(page) && !/\/thoughts\/(list|view)\/$/.test(page),
    }),
    postAssets(),
  ],
});
