/**
 * Content-Cross-Checks, die über das Zod-Schema hinausgehen.
 * Feld-/Typ-/Enum-Validierung übernimmt das Content-Collection-Schema
 * (src/content.config.ts) beim Build — hier werden nur Konsistenzregeln
 * zwischen Feldern geprüft.
 *
 * Aufruf: npm run validate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const ARTICLES_DIR = join(process.cwd(), 'src', 'content', 'articles');

interface Correction {
  date: string | Date;
  type: 'correction' | 'update';
  text: string;
}

interface Frontmatter {
  title?: string;
  status?: string;
  publishedAt?: string | Date;
  updatedAt?: string | Date;
  sources?: { id: string }[];
  claims?: { id: string; sourceIds?: string[] }[];
  corrections?: Correction[];
  retractionReason?: string;
}

const errors: string[] = [];

function fail(file: string, message: string) {
  errors.push(`${file}: ${message}`);
}

/**
 * Body-Konvention (PLAN.md E37): beide Textlängen-Varianten in Wrappern,
 * nichts außerhalb. Kompakt = reiner Fließtext, max 3 Absätze, keine
 * Überschriften. Standard = ##-Sektionen, kein h1.
 */
function checkBodyVariants(file: string, body: string) {
  const kompakt = [...body.matchAll(/<Kompakt>([\s\S]*?)<\/Kompakt>/g)];
  const standard = [...body.matchAll(/<Standard>([\s\S]*?)<\/Standard>/g)];

  if (kompakt.length !== 1) {
    fail(file, `Body braucht genau einen <Kompakt>-Wrapper (gefunden: ${kompakt.length})`);
  }
  if (standard.length !== 1) {
    fail(file, `Body braucht genau einen <Standard>-Wrapper (gefunden: ${standard.length})`);
  }
  if (kompakt.length !== 1 || standard.length !== 1) return;

  const outside = body.replace(kompakt[0][0], '').replace(standard[0][0], '').trim();
  if (outside) {
    fail(file, `Body enthält Inhalt außerhalb der <Kompakt>/<Standard>-Wrapper: „${outside.slice(0, 60)}…"`);
  }

  const kompaktText = kompakt[0][1].trim();
  if (!kompaktText) {
    fail(file, '<Kompakt>-Variante ist leer');
  } else {
    if (/^#{1,6}\s/m.test(kompaktText)) {
      fail(file, '<Kompakt>-Variante muss reiner Fließtext sein (keine Überschriften)');
    }
    const paragraphs = kompaktText.split(/\n\s*\n/).filter((p) => p.trim());
    if (paragraphs.length > 3) {
      fail(file, `<Kompakt>-Variante hat ${paragraphs.length} Absätze (maximal 3)`);
    }
  }

  const standardText = standard[0][1].trim();
  if (!standardText) {
    fail(file, '<Standard>-Variante ist leer');
  } else {
    if (!/^##\s/m.test(standardText)) {
      fail(file, '<Standard>-Variante braucht mindestens eine ##-Überschrift');
    }
    if (/^#\s/m.test(standardText)) {
      fail(file, 'Body darf kein h1 (#) enthalten');
    }
  }
}

function toTime(value: string | Date): number {
  return new Date(value).getTime();
}

let files: string[];
try {
  files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.mdx'));
} catch {
  console.error(`Artikelverzeichnis nicht gefunden: ${ARTICLES_DIR}`);
  process.exit(1);
}

if (files.length === 0) {
  console.warn('Keine Artikel gefunden — nichts zu prüfen.');
  process.exit(0);
}

const slugs = new Map<string, string>();

for (const file of files) {
  const raw = readFileSync(join(ARTICLES_DIR, file), 'utf8');
  let data: Frontmatter;
  let body: string;
  try {
    const parsed = matter(raw);
    data = parsed.data as Frontmatter;
    body = parsed.content;
  } catch (e) {
    fail(file, `Frontmatter nicht parsebar: ${(e as Error).message}`);
    continue;
  }

  checkBodyVariants(file, body);

  const slug = file.replace(/\.mdx$/, '').toLowerCase();
  const existing = slugs.get(slug);
  if (existing) {
    fail(file, `Slug „${slug}" kollidiert mit ${existing}`);
  } else {
    slugs.set(slug, file);
  }

  const sources = data.sources ?? [];
  const claims = data.claims ?? [];
  const corrections = data.corrections ?? [];
  const status = data.status ?? '';

  // ≥ 1 Quelle pro Artikel
  if (sources.length === 0) {
    fail(file, 'Artikel hat keine Quellen (mindestens eine erforderlich)');
  }

  // Quellen-IDs eindeutig
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) fail(file, `Quellen-ID „${source.id}" ist doppelt`);
    sourceIds.add(source.id);
  }

  // claim.sourceIds müssen auf existierende Quellen zeigen
  for (const claim of claims) {
    for (const ref of claim.sourceIds ?? []) {
      if (!sourceIds.has(ref)) {
        fail(file, `Claim „${claim.id}" referenziert unbekannte Quelle „${ref}"`);
      }
    }
  }

  // published/corrected ⇒ publishedAt gesetzt
  if ((status === 'published' || status === 'corrected') && !data.publishedAt) {
    fail(file, `Status „${status}" erfordert publishedAt`);
  }

  // corrected ⇔ mindestens ein corrections-Eintrag mit type: correction
  const hasCorrection = corrections.some((c) => c.type === 'correction');
  if (status === 'corrected' && !hasCorrection) {
    fail(file, 'Status „corrected" erfordert mindestens einen corrections-Eintrag mit type: correction');
  }
  if (status !== 'corrected' && status !== 'retracted' && hasCorrection) {
    fail(file, `Artikel hat Korrektur-Einträge, aber Status „${status}" statt „corrected"`);
  }

  // retracted ⇒ retractionReason
  if (status === 'retracted' && !data.retractionReason?.trim()) {
    fail(file, 'Status „retracted" erfordert retractionReason');
  }

  // updatedAt konsistent mit jüngstem corrections-Datum
  if (corrections.length > 0) {
    const newest = Math.max(...corrections.map((c) => toTime(c.date)));
    if (!data.updatedAt) {
      fail(file, 'Artikel hat corrections-Einträge, aber kein updatedAt');
    } else if (toTime(data.updatedAt) !== newest) {
      fail(
        file,
        `updatedAt (${new Date(data.updatedAt).toISOString().slice(0, 10)}) entspricht nicht dem jüngsten ` +
          `corrections-Datum (${new Date(newest).toISOString().slice(0, 10)})`,
      );
    }
  } else if (data.updatedAt) {
    fail(file, 'updatedAt gesetzt, aber keine corrections-Einträge vorhanden');
  }
}

if (errors.length > 0) {
  console.error(`Content-Validierung fehlgeschlagen (${errors.length} Fehler):\n`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log(`Content-Validierung OK — ${files.length} Artikel geprüft.`);
