// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import sitemapNews from './scripts/sitemap-news.mjs';

// Im CI liefert actions/configure-pages SITE_URL/BASE_PATH: auf GitHub Pages
// ohne Custom Domain https://cmaart.github.io + /ai_news_page, mit Custom
// Domain automatisch https://neuenachrichten.at + Root. Lokal gilt der Fallback.
const site = process.env.SITE_URL || 'https://neuenachrichten.at';
const base = process.env.BASE_PATH || undefined;

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  // sitemapNews muss nach sitemap() laufen (bearbeitet deren Output im Build-Ordner).
  integrations: [mdx(), sitemap(), sitemapNews()],
});
