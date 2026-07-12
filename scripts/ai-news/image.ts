/**
 * Artikelbild-Auswahl + -Verarbeitung (PLAN.md E44).
 *
 * Auswahl DETERMINISTISCH aus der kuratierten Whitelist
 * data/ai-news/image-sources.yaml — keine LLM-Bildsuche: jeder Eintrag ist
 * manuell geprüft (Terms gelesen, Zitat gesichert), die Pipeline matcht nur
 * Keywords/Quell-Domains. Null zusätzliche Tokens, null Interpretationsrisiko.
 *
 * Verarbeitung: Self-Hosting statt Hotlink (DSGVO, Link-Rot) — Download,
 * max. 1600 px Breite, WebP. Ausschließlich Resize + Formatwandlung, KEIN
 * Crop auf Dateiebene (Bearbeitungsverbote in Presse-Nutzungsbedingungen);
 * feste Seitenverhältnisse löst das Layout per object-fit. Jeder Fehler
 * führt zu „Artikel ohne Bild“, nie zum Abbruch des Artikels.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// sharp ist garantierte Astro-Dependency (Default-Image-Service) — bewusst
// transitiv genutzt statt eigener Pin, damit Versionen nicht divergieren.
import sharp from 'sharp';
import { parse } from 'yaml';
import { IMAGE_LICENSES } from '../../src/config/images.ts';
import type { DraftImage } from './types.ts';

export const ASSETS_DIR = join(process.cwd(), 'src', 'assets', 'articles');
const WHITELIST_PATH = join(process.cwd(), 'data', 'ai-news', 'image-sources.yaml');

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 80;
const DOWNLOAD_TIMEOUT_MS = 30_000;
// Hero-Eignung (E44): Hochformat/quadratische Bilder sprengen das Layout,
// zu schmale werden im 1024px-Container unscharf hochskaliert — hart ablehnen.
const MIN_SOURCE_WIDTH = 800;
const MIN_ASPECT_RATIO = 1.2;

/** Agentur-Kennungen im Credit ⇒ Foto ist fast sicher fremdlizenziert — kein Bild. */
export const AGENCY_MARKERS = /\b(apa|getty|reuters|afp|dpa|picture alliance|epa|ap photo|imago|keystone)\b/i;

export interface ImageWhitelistEntry {
  id: string;
  name: string;
  titleKeywords?: string[];
  sourceDomains?: string[];
  /** Nutzungszweck-Einschränkung der Terms (z. B. Parlament: nur politische Berichterstattung). */
  topics?: string[];
  image: DraftImage;
}

export function loadImageWhitelist(): ImageWhitelistEntry[] {
  try {
    const parsed = parse(readFileSync(WHITELIST_PATH, 'utf8')) as { sources?: ImageWhitelistEntry[] };
    return parsed.sources ?? [];
  } catch {
    return [];
  }
}

/**
 * Deterministische Bild-Auswahl: erster Whitelist-Eintrag, dessen Keyword in
 * Titel/Description vorkommt oder dessen Domain unter den Draft-Quellen ist
 * (Reihenfolge in der YAML = Priorität). Ergebnis läuft zusätzlich durch
 * sanitizeDraftImage — auch kuratierte Einträge müssen die Allowlist halten.
 */
export function selectWhitelistImage(draft: {
  title: string;
  description: string;
  topic: string;
  sources: { url: string }[];
}): { entryId: string; image: DraftImage } | null {
  const haystack = `${draft.title} ${draft.description}`.toLowerCase();
  const hosts = draft.sources
    .map((s) => {
      try {
        return new URL(s.url).hostname.toLowerCase();
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  for (const entry of loadImageWhitelist()) {
    if (entry.topics && !entry.topics.includes(draft.topic)) continue;
    const keywordHit = (entry.titleKeywords ?? []).some((k) => keywordMatches(haystack, k));
    const domainHit = (entry.sourceDomains ?? []).some((d) =>
      hosts.some((h) => h === d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`)),
    );
    if (!keywordHit && !domainHit) continue;
    const image = sanitizeDraftImage(entry.image);
    if (!image) {
      console.warn(`Whitelist-Eintrag ${entry.id} hält die Bild-Regeln nicht — übersprungen.`);
      continue;
    }
    return { entryId: entry.id, image };
  }
  return null;
}

/**
 * Keyword-Match auf Wortgrenzen statt Substring — „Meta" darf nicht in
 * „Metadaten" treffen (relevant seit den Tech-Whitelist-Einträgen, E48).
 * Unicode-Grenzen, weil \b bei Umlauten versagt („KI-Förderung").
 */
function keywordMatches(haystack: string, keyword: string): boolean {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);
}

/**
 * Shape-/Regel-Prüfung eines Bild-Kandidaten (Whitelist-Eintrag oder
 * Backfill-Vorschlag). Verstöße verwerfen nur das Bild (Rückgabe null),
 * nie den Artikel — im Zweifel kein Bild.
 */
export function sanitizeDraftImage(image: unknown): DraftImage | null {
  if (!image || typeof image !== 'object') return null;
  const i = image as Partial<DraftImage>;
  const credit = i.credit as Partial<DraftImage['credit']> | undefined;

  const problems: string[] = [];
  if (!isHttpsUrl(i.downloadUrl)) problems.push('downloadUrl fehlt oder ist nicht https');
  if (!i.alt?.trim()) problems.push('alt fehlt');
  if (!i.caption?.trim()) problems.push('caption fehlt');
  if (!credit) problems.push('credit fehlt');
  if (credit) {
    if (!credit.author?.trim()) problems.push('credit.author fehlt');
    if (!credit.license || !(IMAGE_LICENSES as readonly string[]).includes(credit.license)) {
      problems.push(`credit.license nicht in der Allowlist: ${credit.license}`);
    }
    if (!isHttpsUrl(credit.sourceUrl)) problems.push('credit.sourceUrl fehlt oder ist nicht https');
    if (!isHttpsUrl(credit.termsUrl)) problems.push('credit.termsUrl fehlt oder ist nicht https');
    if (!credit.termsQuote?.trim() || credit.termsQuote.trim().length < 15) {
      problems.push('credit.termsQuote fehlt oder ist zu kurz für ein wörtliches Zitat');
    }
    if (credit.author && AGENCY_MARKERS.test(credit.author)) {
      problems.push(`credit.author enthält Agentur-Kennung („${credit.author}“) — fremdlizenziert`);
    }
  }
  if (problems.length > 0) {
    console.warn(`Bild verworfen: ${problems.join('; ')}`);
    return null;
  }

  return {
    downloadUrl: i.downloadUrl!,
    alt: i.alt!.trim(),
    caption: i.caption!.trim(),
    kind: i.kind === 'direct' ? 'direct' : 'symbol',
    credit: {
      author: credit!.author!.trim(),
      license: credit!.license!,
      sourceUrl: credit!.sourceUrl!,
      termsUrl: credit!.termsUrl!,
      termsQuote: credit!.termsQuote!.trim(),
    },
  };
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Lädt das Bild, skaliert auf max. MAX_WIDTH und schreibt
 * src/assets/articles/<slug>/hero.webp. Rückgabe: Frontmatter-Pfad relativ
 * zur Artikeldatei. Wirft bei jedem Problem — Aufrufer fängt und lässt den
 * Artikel ohne Bild erscheinen.
 */
export async function downloadAndProcessImage(slug: string, downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    // UA rein ASCII halten — Nicht-ASCII-Header (früher „für") lösen bei
    // manchen Origins (z. B. rechnungshof.gv.at WAF) HTTP 500 aus.
    headers: { 'user-agent': 'NeueNachrichten/1.0 (+https://neuenachrichten.at; Bildabruf fuer Artikel)' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Bild-Download fehlgeschlagen: HTTP ${response.status} für ${downloadUrl}`);

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Bild-Download lieferte keinen Bild-Content-Type (${contentType || 'unbekannt'})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Bild zu groß: ${Math.round(buffer.byteLength / 1024 / 1024)} MB`);
  }

  // rotate() wendet die EXIF-Orientierung an; resize ohne Crop.
  const { data: webp, info } = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  // Eignungs-Guard nach EXIF-Rotation/Resize (Ratio bleibt beim Resize gleich).
  if (info.width < MIN_SOURCE_WIDTH) {
    throw new Error(`Bild zu schmal für den Hero: ${info.width}px (< ${MIN_SOURCE_WIDTH}px)`);
  }
  if (info.width / info.height < MIN_ASPECT_RATIO) {
    throw new Error(
      `Bild ist Hoch-/Quadratformat (${info.width}×${info.height}) — als Hero ungeeignet (Ratio < ${MIN_ASPECT_RATIO})`,
    );
  }

  const dir = join(ASSETS_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hero.webp'), webp);
  return `../../assets/articles/${slug}/hero.webp`;
}
