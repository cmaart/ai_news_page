import { createHash } from 'node:crypto';

/** utm_*, fbclid/gclid, Fragmente und Trailing Slash entfernen. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = '';
    const params = [...url.searchParams.keys()];
    for (const key of params) {
      if (/^(utm_|fbclid|gclid|ref$|from$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    let s = url.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function itemId(sourceId: string, url: string, title: string, publishedAt?: string): string {
  const normalized = normalizeUrl(url);
  if (normalized) return sha256(`${sourceId}|${normalized}`);
  return sha256(`${sourceId}|${normalizeTitle(title)}|${publishedAt ?? ''}`);
}

const GERMAN_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
  'und', 'oder', 'aber', 'auch', 'noch', 'nur', 'schon', 'sehr', 'mehr', 'wie', 'als', 'bei',
  'mit', 'nach', 'von', 'vor', 'aus', 'auf', 'für', 'fuer', 'über', 'ueber', 'unter', 'gegen',
  'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'wurden', 'hat', 'haben', 'hatte',
  'sich', 'nicht', 'kein', 'keine', 'nun', 'jetzt', 'heute', 'neue', 'neuer', 'neues', 'beim',
  'ins', 'ans', 'zum', 'zur', 'ein', 'im', 'am', 'um', 'an', 'in', 'zu', 'so', 'es', 'er', 'sie',
  'was', 'wer', 'wo', 'wann', 'warum', 'soll', 'sollen', 'kann', 'können', 'koennen', 'muss',
  'müssen', 'muessen', 'will', 'wollen', 'laut', 'wegen', 'trotz', 'nach', 'seit', 'live',
]);

// Zahlwörter → Ziffern, damit „Zwölfjähriger" und „12-Jähriger" bzw. „drei Tote"
// und „3 Tote" beim Clustering matchen (E47). „ein/eins" bewusst ausgenommen
// (Artikel-Ambiguität). Lookarounds statt \b, weil \b in JS ASCII-basiert ist
// und sonst z. B. „dreißig" → „3ßig" zerlegen würde.
const NUMBER_WORDS: Record<string, string> = {
  zwei: '2', drei: '3', vier: '4', fünf: '5', fuenf: '5', sechs: '6', sieben: '7',
  acht: '8', neun: '9', zehn: '10', elf: '11', zwölf: '12', zwoelf: '12',
};
const NUMBER_WORD_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.keys(NUMBER_WORDS).join('|')})(?=jährig|jaehrig|[^\\p{L}\\p{N}]|$)`,
  'gu',
);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[„"“”‚'’«»–—-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(NUMBER_WORD_RE, (word) => NUMBER_WORDS[word])
    .replace(/(?<![\p{L}\p{N}])(\d+)\s+(jährig|jaehrig)/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Leichtes Suffix-Stemming, damit Flexionsformen („verletzt"/„verletzte",
// „Jugendliche"/„Jugendlichen") beim Cluster-Matching zusammenfallen (E47).
// Mindest-Stammlänge 4 verhindert Zerstörung kurzer Wörter („Wien", „Haus").
const STEM_SUFFIXES = ['ern', 'em', 'en', 'er', 'es', 'e', 'n', 's'];

function stemToken(token: string): string {
  if (/^\d+$/.test(token)) return token;
  for (const suffix of STEM_SUFFIXES) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of normalizeTitle(title).split(' ')) {
    // Kurze Zahl-Tokens („3", „50") bewusst NICHT behalten: Beträge/Prozente
    // sind portalsübergreifend zu häufig und erzeugen False-Merges.
    if (token.length > 2 && !GERMAN_STOPWORDS.has(token)) tokens.add(stemToken(token));
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const token of a) if (b.has(token)) n++;
  return n;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '');
}

/** Portal-Kürzel aus sourceId (orf_news → orf) — für „distinct Portale"-Zählung. */
export function portalOf(sourceId: string): string {
  return sourceId.split('_')[0];
}

export function hoursAgo(hours: number, now = new Date()): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function utcDateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
