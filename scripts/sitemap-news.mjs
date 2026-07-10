/**
 * Sitemap-Nachbearbeitung (PLAN.md E45): @astrojs/sitemap kennt weder
 * Google-News-Tags noch Artikel-Metadaten. Dieser Hook reichert die
 * generierte Sitemap nach dem Build an, statt sie zu ersetzen (E8 bleibt):
 *   - <lastmod> aus updatedAt ?? publishedAt je Artikel
 *   - <news:news> für Artikel, die jünger als 48 h sind (Google News liest
 *     nur die letzten 2 Tage)
 *   - <image:image> aus dem og:image der gebauten Artikelseite
 *   - entfernt noindex-URLs (Impressum, Datenschutz, retracted/archived) —
 *     noindex + Sitemap wären widersprüchliche Signale
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
const NOINDEX_PATHS = ['/impressum/', '/datenschutz/'];
const PUBLICATION = { name: 'Neue Nachrichten', language: 'de' };

function loadArticleFrontmatter(articlesDir) {
  const bySlug = new Map();
  for (const file of readdirSync(articlesDir)) {
    if (!file.endsWith('.mdx')) continue;
    const { data } = matter(readFileSync(join(articlesDir, file), 'utf8'));
    bySlug.set(file.replace(/\.mdx$/, ''), data);
  }
  return bySlug;
}

function escapeXml(value) {
  return String(value).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );
}

/** og:image der gebauten Artikelseite — einzige Stelle, an der die finale Asset-URL bekannt ist. */
function ogImageFromHtml(outDir, slug) {
  const htmlPath = join(outDir, 'artikel', slug, 'index.html');
  if (!existsSync(htmlPath)) return undefined;
  const html = readFileSync(htmlPath, 'utf8');
  return html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
}

export default function sitemapNews() {
  return {
    name: 'sitemap-news',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const articles = loadArticleFrontmatter(join(process.cwd(), 'src/content/articles'));
        const now = Date.now();

        const sitemapFiles = readdirSync(outDir).filter((f) => /^sitemap-\d+\.xml$/.test(f));
        if (sitemapFiles.length === 0) {
          logger.warn('Keine sitemap-*.xml im Build-Output gefunden — nichts zu tun.');
          return;
        }

        for (const file of sitemapFiles) {
          const path = join(outDir, file);
          let stamped = 0;
          let newsTagged = 0;
          let removed = 0;

          const xml = readFileSync(path, 'utf8').replace(/<url>.*?<\/url>/gs, (entry) => {
            const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
            if (!loc) return entry;
            const pathname = new URL(loc).pathname;

            if (NOINDEX_PATHS.some((p) => pathname.endsWith(p))) {
              removed += 1;
              return '';
            }

            const slug = pathname.match(/\/artikel\/([^/]+)\/$/)?.[1];
            if (!slug) return entry;
            const data = articles.get(slug);
            if (!data) return entry;

            if (data.status === 'retracted' || data.status === 'archived') {
              removed += 1;
              return '';
            }

            const published = new Date(data.publishedAt);
            const lastmod = new Date(data.updatedAt ?? data.publishedAt);
            let extra = `<lastmod>${lastmod.toISOString()}</lastmod>`;

            if (now - published.getTime() < NEWS_WINDOW_MS) {
              extra +=
                '<news:news><news:publication>' +
                `<news:name>${escapeXml(PUBLICATION.name)}</news:name>` +
                `<news:language>${PUBLICATION.language}</news:language>` +
                '</news:publication>' +
                `<news:publication_date>${published.toISOString()}</news:publication_date>` +
                `<news:title>${escapeXml(data.title)}</news:title>` +
                '</news:news>';
              newsTagged += 1;
            }

            const ogImage = ogImageFromHtml(outDir, slug);
            if (ogImage) {
              extra += `<image:image><image:loc>${escapeXml(ogImage)}</image:loc></image:image>`;
            }

            stamped += 1;
            return entry.replace('</url>', `${extra}</url>`);
          });

          writeFileSync(path, xml);
          logger.info(
            `${file}: ${stamped} Artikel mit lastmod, ${newsTagged} mit news-Tags, ${removed} noindex-URLs entfernt`,
          );
        }
      },
    },
  };
}
