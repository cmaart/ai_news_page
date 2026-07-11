/**
 * Bild-Kandidaten-Scan der zitierten Quell-Seiten (PLAN.md E48, ergänzt E44).
 *
 * PROPOSAL-ONLY: Der Scan übernimmt NIE ein Bild in einen Artikel — E44 gilt
 * unverändert (Bilder ausschließlich aus der kuratierten Whitelist, keine
 * Bilder aus Quell-Artikeln). Er ist reine Recherche-Vorarbeit für die
 * manuelle Whitelist-Pflege: Für neue Drafts ohne Bild werden die zitierten
 * Quell-Seiten nach Bild-Kandidaten durchsucht (og:image, twitter:image,
 * JSON-LD, <figure>-Bilder samt Credit-Text) und klassifiziert in das
 * committete Register data/ai-news/image-candidates.json geschrieben.
 *
 * Die Klassifikation ist ein Triage-Hinweis, NIE eine Rechtsprüfung:
 *   blocked        — Agentur-/Stock-Kennung (Getty, Shutterstock, …) im
 *                    Credit oder in der URL ⇒ sicher fremdlizenziert.
 *   possibly-open  — CC-Hinweis oder Pressekit-/Newsroom-Indiz; lohnt eine
 *                    manuelle Prüfung der Terms (E44-Checkliste).
 *   unknown        — kein verwertbarer Hinweis (die Mehrheit).
 * Auch „possibly-open" wird erst nach menschlichem Terms-Vetting zum
 * Whitelist-Eintrag (data/ai-news/image-sources.yaml, Kopfkommentar).
 *
 * Es wird nur HTML geladen, nie Bilddateien. Fehler (Paywall, Bot-Block,
 * Timeout) sind erwartbar und degradieren still — wie fulltext.ts (E40).
 * scanAndReportImageCandidates wirft NIE, damit ein Scan-Fehler nie als
 * Draft-Fehler zählt.
 *
 * CLI (zum Testen ohne Pipeline, schreibt kein Register):
 *   npx tsx scripts/ai-news/image-scan.ts <url> [...urls]
 *   npx tsx scripts/ai-news/image-scan.ts --html <datei> [--url <seiten-url>]
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { ARTICLES_DIR } from './article.ts';
import { AGENCY_MARKERS } from './image.ts';
import { envInt } from './util.ts';

const REPORT_PATH = join(process.cwd(), 'data', 'ai-news', 'image-candidates.json');
const SCAN_TIMEOUT_MS = envInt('AI_NEWS_IMAGE_SCAN_TIMEOUT_MS', 8_000);
const MAX_PAGES_PER_ARTICLE = 4;
const MAX_CANDIDATES_PER_PAGE = 5;
// DSGVO-Datensparsamkeit: Credit-Texte (Fotografen-Namen) nur so lange
// aufheben, wie sie als Whitelist-Recherche-Lead nützlich sind.
const RETENTION_DAYS = 30;
const USER_AGENT = 'neue-nachrichten-research/1.0 (+https://github.com/cmaart/ai_news_page)';

/** Stock-Kennungen ergänzen die Agentur-Liste aus image.ts (E44: „lizenzfrei" ≠ frei nutzbar). */
const STOCK_MARKERS = /\b(shutterstock|istock|adobe stock|alamy|depositphotos|dreamstime|123rf|stock photo|stockfoto)\b/i;
/** Indizien für offene Lizenzen bzw. Presse-Angebote — nur ein Prüf-Hinweis. */
const OPEN_HINTS = /\b(cc[ -]?by(?:[ -]?sa)?(?:[ -]\d\.\d)?|cc0|public domain|gemeinfrei|creativecommons\.org|press ?kit|pressefotos?|pressebilder|honorarfrei|media ?assets|newsroom|courtesy of)\b/i;
/** URL-Muster, die sicher keine Artikelbilder sind. */
const NOISE_URL = /(logo|icon|favicon|avatar|sprite|placeholder|1x1|pixel|badge|button)/i;

export type CandidateClassification = 'blocked' | 'unknown' | 'possibly-open';

export interface ImageCandidate {
  /** Gescannte Quell-Seite (Artikel-Quelle aus dem Frontmatter). */
  sourceUrl: string;
  /** Absolute Bild-URL — nur als Recherche-Verweis, wird nie heruntergeladen. */
  imageUrl: string;
  origin: 'og:image' | 'twitter:image' | 'json-ld' | 'figure';
  /** Credit-/Bildunterschrift-Text in Bildnähe (figcaption), falls vorhanden. */
  creditText?: string;
  classification: CandidateClassification;
  reason: string;
}

interface CandidateReport {
  version: 1;
  updatedAt: string;
  articles: Record<
    string,
    { title: string; scannedAt: string; candidates: ImageCandidate[] }
  >;
}

/**
 * Reine, netzwerkfreie Extraktion + Klassifikation aller Bild-Kandidaten
 * einer HTML-Seite. Relative URLs werden gegen pageUrl aufgelöst; Duplikate
 * (gleiche Bild-URL) und offensichtliches Rauschen (Logos, Tracking-Pixel)
 * fliegen raus. Maximal MAX_CANDIDATES_PER_PAGE Kandidaten.
 */
export function extractImageCandidatesFromHtml(html: string, pageUrl: string): ImageCandidate[] {
  const found: { imageUrl: string; origin: ImageCandidate['origin']; creditText?: string }[] = [];

  for (const meta of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attrValue(meta, 'property') ?? attrValue(meta, 'name') ?? '';
    const content = attrValue(meta, 'content');
    if (!content) continue;
    if (/^og:image(:secure_url)?$/i.test(key)) found.push({ imageUrl: content, origin: 'og:image' });
    else if (/^twitter:image(:src)?$/i.test(key)) found.push({ imageUrl: content, origin: 'twitter:image' });
  }

  for (const block of html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    try {
      for (const url of collectJsonLdImages(JSON.parse(body))) {
        found.push({ imageUrl: url, origin: 'json-ld' });
      }
    } catch {
      // kaputtes/gekürztes JSON-LD ist häufig — ignorieren
    }
  }

  for (const figure of html.match(/<figure\b[\s\S]*?<\/figure>/gi) ?? []) {
    const img = figure.match(/<img\b[^>]*>/i)?.[0];
    const src = img ? attrValue(img, 'src') : undefined;
    if (!src) continue;
    const caption = figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1];
    const creditText = caption ? textOf(caption) : undefined;
    found.push({ imageUrl: src, origin: 'figure', ...(creditText ? { creditText } : {}) });
  }

  const seen = new Set<string>();
  const candidates: ImageCandidate[] = [];
  for (const item of found) {
    const absolute = resolveImageUrl(item.imageUrl, pageUrl);
    if (!absolute || NOISE_URL.test(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    candidates.push({
      sourceUrl: pageUrl,
      imageUrl: absolute,
      origin: item.origin,
      ...(item.creditText ? { creditText: item.creditText } : {}),
      ...classifyCandidate({ imageUrl: absolute, creditText: item.creditText }, html),
    });
    if (candidates.length >= MAX_CANDIDATES_PER_PAGE) break;
  }
  return candidates;
}

/**
 * Triage-Klassifikation eines Kandidaten — bewusst konservativ: blocked
 * schlägt possibly-open, und ohne klares Indiz bleibt es unknown. Das ist
 * NIE eine Rechtsprüfung; die trifft ein Mensch anhand der Terms (E44).
 */
export function classifyCandidate(
  candidate: { imageUrl: string; creditText?: string },
  pageHtml: string,
): { classification: CandidateClassification; reason: string } {
  // _ und - zu Leerzeichen: „shutterstock_123.jpg" muss die \b-Marker treffen.
  const near = `${candidate.creditText ?? ''} ${candidate.imageUrl}`.replace(/[_-]/g, ' ');
  const agency = near.match(AGENCY_MARKERS)?.[1];
  if (agency) return { classification: 'blocked', reason: `Agentur-Kennung: ${agency.toLowerCase()}` };
  const stock = near.match(STOCK_MARKERS)?.[1];
  if (stock) return { classification: 'blocked', reason: `Stock-Kennung: ${stock.toLowerCase()}` };

  const nearHint = near.match(OPEN_HINTS)?.[1];
  if (nearHint) return { classification: 'possibly-open', reason: `Hinweis am Bild: „${nearHint}“` };
  if (/creativecommons\.org\/(licenses|publicdomain)/i.test(pageHtml)) {
    return { classification: 'possibly-open', reason: 'Creative-Commons-Link auf der Seite (Bildbezug unklar)' };
  }
  return { classification: 'unknown', reason: 'kein Lizenz-/Credit-Hinweis gefunden' };
}

/**
 * Scannt die zitierten Quell-URLs eines neuen Drafts (max. MAX_PAGES_PER_ARTICLE)
 * und schreibt gefundene Kandidaten ins Register + GITHUB_STEP_SUMMARY.
 * Wirft NIE — jeder Fehler wird geloggt und ergibt 0 Kandidaten.
 * Rückgabe: Anzahl gefundener Kandidaten (für die Run-Statistik).
 */
export async function scanAndReportImageCandidates(input: {
  slug: string;
  title: string;
  sources: { url: string }[];
  nowIso: string;
}): Promise<number> {
  try {
    const urls = input.sources
      .map((s) => s.url)
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, MAX_PAGES_PER_ARTICLE);
    if (urls.length === 0) return 0;

    const settled = await Promise.allSettled(urls.map(async (url) => extractImageCandidatesFromHtml(await fetchHtml(url), url)));
    const candidates = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (candidates.length === 0) return 0;

    writeReport(input, candidates);
    appendStepSummary(input.slug, candidates);
    console.log(
      `Bild-Kandidaten für ${input.slug}: ${candidates.length} (${candidates.filter((c) => c.classification === 'possibly-open').length} possibly-open) → data/ai-news/image-candidates.json`,
    );
    return candidates.length;
  } catch (error) {
    console.warn(`Bild-Kandidaten-Scan fehlgeschlagen für ${input.slug}: ${(error as Error).message}`);
    return 0;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.includes('html')) throw new Error(`kein HTML (${contentType})`);
  return response.text();
}

/** Register laden, Artikel-Eintrag ersetzen, alte/erledigte Einträge prunen, speichern. */
function writeReport(input: { slug: string; title: string; nowIso: string }, candidates: ImageCandidate[]): void {
  let report: CandidateReport = { version: 1, updatedAt: input.nowIso, articles: {} };
  try {
    const parsed = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as CandidateReport;
    if (parsed.version === 1 && parsed.articles) report = parsed;
  } catch {
    // fehlt beim ersten Lauf / kaputt ⇒ frisch beginnen
  }

  report.articles[input.slug] = { title: input.title, scannedAt: input.nowIso, candidates };
  const cutoff = Date.parse(input.nowIso) - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [slug, entry] of Object.entries(report.articles)) {
    const scannedAt = Date.parse(entry.scannedAt);
    if (!Number.isFinite(scannedAt) || scannedAt < cutoff || articleResolved(slug)) {
      delete report.articles[slug];
    }
  }
  report.updatedAt = input.nowIso;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/** Erledigt = Artikel gelöscht oder hat inzwischen ein Bild im Frontmatter. */
function articleResolved(slug: string): boolean {
  try {
    const raw = readFileSync(join(ARTICLES_DIR, `${slug}.mdx`), 'utf8');
    return Boolean((matter(raw).data as { image?: unknown }).image);
  } catch {
    return true;
  }
}

/** Kompakte Markdown-Tabelle in die Actions-Run-Zusammenfassung (nur in CI). */
function appendStepSummary(slug: string, candidates: ImageCandidate[]): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const cell = (v: string | undefined): string => (v ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 120);
  const rows = candidates
    .map((c) => `| ${c.classification} | ${cell(c.creditText)} | ${cell(c.reason)} | ${cell(c.imageUrl)} |`)
    .join('\n');
  appendFileSync(
    summaryPath,
    `\n### Bild-Kandidaten: \`${slug}\`\n\nProposal-only (E48) — Übernahme nur nach manuellem Terms-Vetting in die Whitelist.\n\n| Klasse | Credit | Grund | Bild-URL |\n| --- | --- | --- | --- |\n${rows}\n`,
    'utf8',
  );
}

function attrValue(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  const value = match?.[2] ?? match?.[3];
  return value ? decodeEntities(value).trim() || undefined : undefined;
}

function resolveImageUrl(src: string, pageUrl: string): string | undefined {
  // Kaputtes Schema („ht!tp://…") würde als relativer Pfad aufgelöst — raus damit.
  if (src.includes('://') && !/^https?:\/\//i.test(src)) return undefined;
  try {
    const url = new URL(src, pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/** JSON-LD kann image als String, Objekt {url}, Array oder in @graph tragen. */
function collectJsonLdImages(node: unknown, depth = 0): string[] {
  if (depth > 6 || !node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((n) => collectJsonLdImages(n, depth + 1));
  const record = node as Record<string, unknown>;
  const urls: string[] = [];
  const image = record.image ?? record.thumbnailUrl;
  for (const value of Array.isArray(image) ? image : [image]) {
    if (typeof value === 'string') urls.push(value);
    else if (value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string') {
      urls.push((value as { url: string }).url);
    }
  }
  if (Array.isArray(record['@graph'])) urls.push(...collectJsonLdImages(record['@graph'], depth + 1));
  return urls;
}

/** Tags strippen + gängige Entities dekodieren — reicht für figcaption-Credits. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  copy: '©', ndash: '–', mdash: '—',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' ';
  }
}

// ---------------------------------------------------------------------------
// CLI: Kandidaten ansehen, ohne Register-Write — für Fixture-Tests (--html)
// und Stichproben gegen echte URLs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const htmlIdx = args.indexOf('--html');
  if (htmlIdx >= 0) {
    const file = args[htmlIdx + 1];
    if (!file) {
      console.error('Aufruf: npx tsx scripts/ai-news/image-scan.ts --html <datei> [--url <seiten-url>]');
      process.exit(1);
    }
    const urlIdx = args.indexOf('--url');
    const pageUrl = urlIdx >= 0 ? args[urlIdx + 1] : 'https://example.org/artikel';
    const candidates = extractImageCandidatesFromHtml(readFileSync(file, 'utf8'), pageUrl!);
    console.log(JSON.stringify(candidates, null, 2));
  } else if (args.length > 0) {
    for (const url of args) {
      try {
        const candidates = extractImageCandidatesFromHtml(await fetchHtml(url), url);
        console.log(JSON.stringify({ url, candidates }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ url, error: (error as Error).message }, null, 2));
      }
    }
  } else {
    console.error('Aufruf: npx tsx scripts/ai-news/image-scan.ts <url> [...urls] | --html <datei> [--url <seiten-url>]');
    process.exit(1);
  }
}
