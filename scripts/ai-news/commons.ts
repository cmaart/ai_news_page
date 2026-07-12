/**
 * Automatische Wikimedia-Commons-Bildsuche (PLAN.md E49, revidiert E44).
 *
 * DETERMINISTISCH: reine MediaWiki-API-Abfrage, KEINE LLM-Turns, keine Tokens.
 * Das war E44s Haupteinwand gegen automatische Bildsuche (Token-Kosten +
 * Interpretationsrisiko unbeaufsichtigt in CI) — beides entfällt hier, weil
 * Auswahl + Lizenz-Mapping regelbasiert sind.
 *
 * Läuft als FALLBACK NACH der kuratierten Whitelist (selectWhitelistImage):
 * ein Pressefoto der zitierten Institution schlägt immer ein Commons-Symbolbild.
 *
 * RESTRISIKO (E49, bewusst akzeptiert): Commons ist User-Upload — Lizenz-Tags
 * nicht garantiert korrekt (Copyfraud), und CC deckt keine
 * Persönlichkeitsrechte (§ 78 UrhG). Guards mildern, eliminieren nicht:
 *   - nur Lizenzen aus der Allowlist (commonsLicenseToAllowlist)
 *   - extmetadata `Restrictions` muss leer sein (Marken-/Personenrechte-Flag)
 *   - Agentur-Marker im Urheber ⇒ ablehnen
 *   - Sensitivity-/Framing-Gate liegt beim Aufrufer (run.ts): kein Commons bei
 *     high-sensitivity/high-framing Stories (Verbrechen/Opfer/Kinder)
 *   - `kind` IMMER 'symbol' ⇒ Layout kennzeichnet „(Symbolbild)"
 * Jeder Fehler/Zweifel ⇒ Rückgabe null = Artikel ohne Bild (nie Abbruch).
 */
import { commonsLicenseToAllowlist, LICENSE_URLS } from '../../src/config/images.ts';
import { AGENCY_MARKERS, sanitizeDraftImage } from './image.ts';
import type { DraftImage } from './types.ts';

const API_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const REQUEST_TIMEOUT_MS = 15_000;
const SEARCH_LIMIT = 20;
const THUMB_WIDTH = 1600;
// Muss zu den Hero-Guards in image.ts passen (MIN_SOURCE_WIDTH/MIN_ASPECT_RATIO) —
// hier vorab filtern spart Downloads, die downloadAndProcessImage eh verwerfen würde.
const MIN_WIDTH = 800;
const MIN_ASPECT_RATIO = 1.2;
// Nur raster-Formate, die als Hero taugen; SVG/TIFF/GIF bewusst raus.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const USER_AGENT =
  'NeueNachrichten/1.0 (+https://neuenachrichten.at; Commons-Bildsuche fuer Artikel)';

/** Häufige deutsche Stoppwörter — aus der Suchanfrage entfernt (rein heuristisch). */
const STOPWORDS = new Set([
  'und', 'oder', 'aber', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen',
  'einem', 'einer', 'eines', 'für', 'mit', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei',
  'nach', 'über', 'unter', 'vor', 'nicht', 'auch', 'noch', 'wird', 'wurde', 'werden', 'sind',
  'wegen', 'gegen', 'mehr', 'sich', 'ihre', 'sein', 'seine', 'dass', 'wie', 'als', 'ist',
]);

interface CommonsImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  width?: number;
  height?: number;
  mime?: string;
  extmetadata?: Record<string, { value?: string }>;
}

interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: CommonsImageInfo[];
}

export interface CommonsSelection {
  image: DraftImage;
  /** Commons-Dateititel (für Log/Audit). */
  fileTitle: string;
  /** 'event' = Titel-Nomen matchten das Bild; 'ressort' = generisches Topic-Symbol. */
  match: 'event' | 'ressort';
}

// Event-Match verlangt Übereinstimmung von mindestens so vielen distinkten
// Titel-Nomen im Kandidaten-Text — verhindert Homonym-Fehltreffer (E49-Hybrid:
// „Andalusien" allein dürfte keine Rosensorte ziehen).
const EVENT_MIN_COVERAGE = 2;

/**
 * Kuratierte Ressort-Symbolbild-Suchbegriffe (E49-Hybrid). Greifen NUR, wenn
 * kein Event-Match ≥ EVENT_MIN_COVERAGE gefunden wird — dann lieber ein würdiges
 * generisches Symbol als ein absurder Einzelwort-Treffer. Begriffe bewusst breit
 * + neutral gewählt (liefern verlässlich Querformat-CC-Bilder); Reihenfolge =
 * Fallback-Kaskade. `kind` bleibt 'symbol' (Layout kennzeichnet „(Symbolbild)").
 */
const RESSORT_QUERIES: Record<string, string[]> = {
  politik: ['Parlament Wien', 'Parlamentsgebäude'],
  wirtschaft: ['Wiener Börse', 'Euro Banknoten'],
  technologie: ['Rechenzentrum', 'Serverraum'],
  wissenschaft: ['Labor Forschung', 'Laboratorium'],
  gesellschaft: ['Fußgängerzone Wien', 'Wien Straße'],
};

/**
 * Sucht ein passendes Symbolbild auf Commons für einen Draft und gibt einen
 * geprüften DraftImage-Kandidaten zurück (bereits durch sanitizeDraftImage),
 * oder null. Wirft NIE — jeder Netz-/Parse-/Regel-Fehler ⇒ null.
 */
export async function selectCommonsImage(draft: {
  title: string;
  description: string;
  topic: string;
}): Promise<CommonsSelection | null> {
  try {
    const nouns = extractNouns(draft.title);

    // Phase 1 — Event-Match: OR-Suche über die Titel-Nomen, dann nur Kandidaten
    // akzeptieren, deren Text ≥ EVENT_MIN_COVERAGE der Nomen enthält (Relevanz).
    if (nouns.length >= EVENT_MIN_COVERAGE) {
      const pages = sortByRelevance(await searchCommons(nouns.slice(0, 4).join(' OR ')));
      for (const page of pages) {
        const candidate = buildCandidate(page, draft, 'event');
        if (!candidate) continue;
        const haystack = `${candidate.fileTitle} ${candidate.image.alt} ${candidate.image.caption}`;
        if (countNounMatches(nouns, haystack) >= EVENT_MIN_COVERAGE) return candidate;
      }
    }

    // Phase 2 — Ressort-Symbolbild: kuratierte, breite Suchbegriffe je Topic.
    for (const query of RESSORT_QUERIES[draft.topic] ?? []) {
      const pages = sortByRelevance(await searchCommons(query));
      for (const page of pages) {
        const candidate = buildCandidate(page, draft, 'ressort');
        if (candidate) return candidate;
      }
    }
    return null;
  } catch (error) {
    console.warn(`Commons-Bildsuche fehlgeschlagen: ${(error as Error).message}`);
    return null;
  }
}

/** generator=search liefert Seiten unsortiert — `index` = Relevanz-Reihenfolge. */
function sortByRelevance(pages: CommonsPage[]): CommonsPage[] {
  return pages.sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9));
}

/**
 * Großgeschriebene Titel-Tokens = Substantive/Eigennamen im Deutschen (Verben/
 * Artikel/Adjektive fallen weg). Deterministische Heuristik für die Bildsuche.
 */
function extractNouns(title: string): string[] {
  return title
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && /\p{Lu}/u.test(w) && !STOPWORDS.has(w.toLowerCase()));
}

/** Anzahl distinkter Nomen, die (case-insensitiv) im Kandidaten-Text vorkommen. */
function countNounMatches(nouns: string[], haystack: string): number {
  const h = haystack.toLowerCase();
  return new Set(nouns.map((n) => n.toLowerCase()).filter((n) => h.includes(n))).size;
}

async function searchCommons(query: string): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6', // File:
    gsrlimit: String(SEARCH_LIMIT),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'License|LicenseShortName|LicenseUrl|Artist|Restrictions|ImageDescription',
  });

  const response = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Commons-API HTTP ${response.status}`);

  const data = (await response.json()) as { query?: { pages?: CommonsPage[] } };
  return data.query?.pages ?? [];
}

/**
 * Baut aus einer Commons-Seite einen geprüften DraftImage-Kandidaten oder null.
 * Jeder Guard-Verstoß ⇒ null (Kandidat übersprungen).
 */
function buildCandidate(
  page: CommonsPage,
  draft: { title: string; description: string },
  match: 'event' | 'ressort',
): CommonsSelection | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;

  const { width, height, mime } = info;
  if (!mime || !ALLOWED_MIME.has(mime)) return null;
  if (!width || !height || width < MIN_WIDTH || width / height < MIN_ASPECT_RATIO) return null;

  const downloadUrl = info.thumburl ?? info.url;
  const sourceUrl = info.descriptionurl;
  if (!isHttps(downloadUrl) || !isHttps(sourceUrl)) return null;

  const meta = info.extmetadata ?? {};
  // Restrictions non-empty ⇒ Marken-/Persönlichkeits-/Sonderauflage — ablehnen.
  if (emv(meta, 'Restrictions')) return null;

  const license = commonsLicenseToAllowlist(emv(meta, 'License') ?? '', emv(meta, 'LicenseShortName'));
  if (!license) return null;

  const author = resolveAuthor(stripTags(emv(meta, 'Artist')), license);
  if (!author) return null;
  if (AGENCY_MARKERS.test(author)) return null;

  const licenseUrl = emv(meta, 'LicenseUrl');
  const termsUrl = isHttps(licenseUrl) ? licenseUrl! : LICENSE_URLS[license];
  if (!isHttps(termsUrl)) return null;

  const description = stripTags(emv(meta, 'ImageDescription'));
  const shortName = emv(meta, 'LicenseShortName') ?? license;
  const alt = truncate(description || draft.title, 150);
  const caption = truncate(description || draft.title, 120);

  // termsQuote: wahrheitsgemäße Herkunftsangabe der Lizenz (≥15 Zeichen für
  // sanitizeDraftImage). Der eigentliche Beleg ist sourceUrl = Dateiseite.
  const termsQuote = `Lizenzangabe „${shortName}“ laut Dateibeschreibungsseite auf Wikimedia Commons.`;

  // kind IMMER 'symbol' — Commons-Bild zeigt nie das konkrete Ereignis.
  return finalize(
    {
      downloadUrl: downloadUrl!,
      alt,
      caption,
      kind: 'symbol',
      credit: { author, license, sourceUrl: sourceUrl!, termsUrl, termsQuote },
    },
    page.title ?? '(unbekannt)',
    match,
  );
}

/** Letzter Gate: durch sanitizeDraftImage (dieselben Regeln wie Whitelist/Backfill). */
function finalize(
  image: DraftImage,
  fileTitle: string,
  match: 'event' | 'ressort',
): CommonsSelection | null {
  const sanitized = sanitizeDraftImage(image);
  return sanitized ? { image: sanitized, fileTitle, match } : null;
}

/**
 * Urheber bestimmen: BY/BY-SA verlangen Namensnennung ⇒ ohne Artist ablehnen
 * (null). CC0/Public Domain dürfen anonym sein ⇒ neutraler Fallback.
 */
function resolveAuthor(artist: string, license: string): string | null {
  if (artist) return artist;
  if (license === 'CC0 1.0' || license === 'Public Domain') return 'Wikimedia Commons';
  return null;
}

function emv(meta: Record<string, { value?: string }>, key: string): string | undefined {
  const value = meta[key]?.value?.trim();
  return value ? value : undefined;
}

/** Artist/Description sind oft HTML — Tags strippen, Whitespace normalisieren. */
function stripTags(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function isHttps(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
