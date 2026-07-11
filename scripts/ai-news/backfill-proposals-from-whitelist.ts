/**
 * Backfill-Vorschläge aus der Whitelist generieren (PLAN.md E48, Teil von E44).
 *
 * Läuft nach Whitelist-Erweiterungen über die Bestandsartikel: Für jeden
 * Artikel OHNE Bild wird dieselbe deterministische Auswahl wie in der
 * Pipeline ausgeführt (selectWhitelistImage) und das Ergebnis als
 * Proposals-JSON für backfill-images.ts geschrieben. Das Score-Gate der
 * Pipeline (AI_NEWS_IMAGE_MIN_SCORE) gilt hier bewusst nicht — der Backfill
 * landet als Review-PR, menschliches Review ersetzt das Gate.
 *
 * Aufruf:
 *   npx tsx scripts/ai-news/backfill-proposals-from-whitelist.ts <ausgabe.json>
 *   danach: npx tsx scripts/ai-news/backfill-images.ts <ausgabe.json>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ARTICLES_DIR } from './article.ts';
import { selectWhitelistImage } from './image.ts';

const outPath = process.argv[2];
if (!outPath) {
  console.error('Aufruf: npx tsx scripts/ai-news/backfill-proposals-from-whitelist.ts <ausgabe.json>');
  process.exit(1);
}

interface ArticleFm {
  title?: string;
  description?: string;
  topic?: string;
  image?: unknown;
  sources?: { url?: string }[];
}

const proposals: { slug: string; image: unknown; reason: string }[] = [];
let withImage = 0;
let noMatch = 0;

for (const file of readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.mdx')).sort()) {
  const slug = file.replace(/\.mdx$/, '');
  const data = matter(readFileSync(join(ARTICLES_DIR, file), 'utf8')).data as ArticleFm;
  if (data.image) {
    withImage += 1;
    continue;
  }
  const selection = selectWhitelistImage({
    title: data.title ?? '',
    description: data.description ?? '',
    topic: data.topic ?? '',
    sources: (data.sources ?? []).flatMap((s) => (s.url ? [{ url: s.url }] : [])),
  });
  if (!selection) {
    noMatch += 1;
    continue;
  }
  proposals.push({ slug, image: selection.image, reason: `whitelist:${selection.entryId}` });
  console.log(`✓ ${slug} → ${selection.entryId}`);
}

writeFileSync(outPath, `${JSON.stringify(proposals, null, 2)}\n`, 'utf8');
console.log(`\n${proposals.length} Vorschläge geschrieben (${withImage} Artikel hatten schon ein Bild, ${noMatch} ohne Whitelist-Treffer) → ${outPath}`);
