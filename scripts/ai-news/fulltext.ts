/**
 * Volltext-Abruf vor der Triage (PLAN.md E40): Für Triage-Kandidaten werden
 * bis zu 2 Artikel-URLs pro Cluster geladen und als Text-Auszug an Haiku
 * gegeben — Substanz-Beurteilung statt Raten aus RSS-Snippets. Die Auszüge
 * dienen ausschließlich der Beurteilung, nie dem Nachdruck (E28 bleibt).
 * Fehler (Paywall, Timeout, Bot-Block) sind erwartbar und degradieren still
 * auf das RSS-Summary.
 */
import type { Cluster, ClusterItem } from './types.ts';
import { envInt, portalOf } from './util.ts';

const FULLTEXT_TIMEOUT_MS = envInt('AI_NEWS_FULLTEXT_TIMEOUT_MS', 8_000);
const FULLTEXT_MAX_CHARS = envInt('AI_NEWS_FULLTEXT_MAX_CHARS', 3_500);
const FULLTEXT_PER_CLUSTER = envInt('AI_NEWS_FULLTEXT_PER_CLUSTER', 2);
const USER_AGENT = 'neue-nachrichten-research/1.0 (+https://github.com/cmaart/ai_news_page)';

/** Medien-Items zuerst, ein Item pro Portal, max FULLTEXT_PER_CLUSTER. */
export function pickFulltextItems(cluster: Cluster): ClusterItem[] {
  const sorted = [...cluster.items].sort((a, b) => {
    if (a.sourceType !== b.sourceType) return a.sourceType === 'media' ? -1 : 1;
    return 0;
  });
  const picked: ClusterItem[] = [];
  const portals = new Set<string>();
  for (const item of sorted) {
    const portal = portalOf(item.sourceId);
    if (portals.has(portal)) continue;
    portals.add(portal);
    picked.push(item);
    if (picked.length >= FULLTEXT_PER_CLUSTER) break;
  }
  return picked;
}

/** Lädt Volltexte für die ausgewählten Items und schreibt sie in item.fulltext. */
export async function enrichClusterWithFulltext(cluster: Cluster): Promise<number> {
  const targets = pickFulltextItems(cluster);
  const results = await Promise.all(
    targets.map(async (item) => {
      try {
        const text = await fetchArticleText(item.url);
        if (text) {
          item.fulltext = text;
          return 1;
        }
      } catch {
        // still degradieren — RSS-Summary bleibt als Fallback
      }
      return 0;
    }),
  );
  return results.reduce<number>((a, b) => a + b, 0);
}

async function fetchArticleText(url: string): Promise<string | undefined> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FULLTEXT_TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'de-AT,de;q=0.9',
    },
  });
  if (!response.ok) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.includes('html')) return undefined;
  const html = await response.text();
  const text = extractText(html);
  // Unter ~300 Zeichen ist es Consent-Wall/Teaser — kein Mehrwert gegenüber Summary.
  return text.length >= 300 ? text.slice(0, FULLTEXT_MAX_CHARS) : undefined;
}

/**
 * Naive Readability: script/style/nav raus, bevorzugt <article>/<main>,
 * dann Tags strippen und Entities dekodieren. Reicht für Substanz-Triage.
 */
export function extractText(html: string): string {
  let scope = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const article = scope.match(/<article\b[\s\S]*?<\/article>/i);
  const main = scope.match(/<main\b[\s\S]*?<\/main>/i);
  scope = article?.[0] ?? main?.[0] ?? scope;
  scope = scope
    .replace(/<(header|footer|nav|aside|figure)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(h1|h2|h3|p|li|br|div)\b/gi, '\n<$1');

  return decodeEntities(scope.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  bdquo: '„', ldquo: '"', rdquo: '"', lsquo: '‚', rsquo: '’',
  ndash: '–', mdash: '—', hellip: '…', eacute: 'é', egrave: 'è',
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
