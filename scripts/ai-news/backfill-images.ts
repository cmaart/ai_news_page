/**
 * Einmaliger Bild-Backfill für Bestandsartikel (PLAN.md E44, Kalibrierungs-PR).
 *
 * Input: JSON-Datei mit Bild-Vorschlägen aus der Recherche —
 *   [{ "slug": string, "image": DraftImage | null, "reason": string }]
 * Jeder Vorschlag durchläuft dieselbe Prüfung + Verarbeitung wie in der
 * Pipeline (sanitizeDraftImage → downloadAndProcessImage) und wird dann
 * textuell ans Frontmatter angehängt (minimaler Diff, kein YAML-Rewrite
 * des restlichen Frontmatters). Artikel mit bestehendem Bild werden
 * übersprungen.
 *
 * Aufruf: npx tsx scripts/ai-news/backfill-images.ts <vorschlaege.json> [--replace]
 *   --replace: bestehendes Bild ersetzen statt überspringen (setzt voraus,
 *   dass `image:` der letzte Frontmatter-Key ist — so schreibt es dieses Skript).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { stringify } from 'yaml';
import { ARTICLES_DIR } from './article.ts';
import { downloadAndProcessImage, sanitizeDraftImage } from './image.ts';

interface Proposal {
  slug: string;
  image: unknown;
  reason?: string;
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Aufruf: npx tsx scripts/ai-news/backfill-images.ts <vorschlaege.json>');
  process.exit(1);
}

const replaceMode = process.argv.includes('--replace');
const proposals = JSON.parse(readFileSync(inputPath, 'utf8')) as Proposal[];
const nowIso = new Date().toISOString();
let applied = 0;
let skipped = 0;

for (const proposal of proposals) {
  const { slug } = proposal;
  if (!proposal.image) {
    console.log(`— ${slug}: kein Bild (${proposal.reason ?? 'ohne Begründung'})`);
    skipped += 1;
    continue;
  }

  const path = join(ARTICLES_DIR, `${slug}.mdx`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`✗ ${slug}: Artikeldatei nicht gefunden`);
    skipped += 1;
    continue;
  }

  if ((matter(raw).data as { image?: unknown }).image) {
    if (!replaceMode) {
      console.log(`— ${slug}: hat bereits ein Bild — übersprungen`);
      skipped += 1;
      continue;
    }
    // Bestehenden image-Block entfernen (letzter Frontmatter-Key, siehe Kopfkommentar).
    const stripped = raw.replace(/\r?\nimage:\r?\n[\s\S]*?(\r?\n---\r?\n)/, '$1');
    if (stripped === raw) {
      console.error(`✗ ${slug}: bestehender image-Block nicht am Frontmatter-Ende — manuell ersetzen`);
      skipped += 1;
      continue;
    }
    raw = stripped;
  }

  const image = sanitizeDraftImage(proposal.image);
  if (!image) {
    console.error(`✗ ${slug}: Vorschlag hält den Regeln nicht stand — verworfen`);
    skipped += 1;
    continue;
  }

  try {
    const file = await downloadAndProcessImage(slug, image.downloadUrl);
    const imageYaml = stringify(
      {
        image: {
          file,
          alt: image.alt,
          caption: image.caption,
          kind: image.kind,
          credit: { ...image.credit, retrievedAt: nowIso },
        },
      },
      { lineWidth: 0 },
    ).trimEnd();

    // Textuell vor das schließende --- einfügen — restliches Frontmatter bleibt byte-identisch.
    const updated = raw.replace(/\r?\n---\r?\n/, `\n${imageYaml}\n---\n`);
    if (updated === raw) throw new Error('Frontmatter-Ende nicht gefunden');
    writeFileSync(path, updated, 'utf8');
    console.log(`✓ ${slug}: ${image.credit.license} — ${image.credit.author}`);
    applied += 1;
  } catch (error) {
    console.error(`✗ ${slug}: ${(error as Error).message}`);
    skipped += 1;
  }
}

console.log(`\nFertig: ${applied} Bilder übernommen, ${skipped} ohne Bild/übersprungen.`);
