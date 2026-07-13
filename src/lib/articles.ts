import type { CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;
export type ArticleData = Article['data'];
export type Source = ArticleData['sources'][number];
export type Claim = ArticleData['claims'][number];

export const TOPICS = ['politik', 'wirtschaft', 'gesellschaft', 'technologie', 'wissenschaft', 'sport', 'kultur'] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  politik: 'Politik',
  wirtschaft: 'Wirtschaft',
  gesellschaft: 'Gesellschaft',
  technologie: 'Technologie',
  wissenschaft: 'Wissenschaft',
  sport: 'Sport',
  kultur: 'Kultur',
};

export const COUNTRY_LABELS: Record<ArticleData['country'], string> = {
  at: 'Österreich',
  de: 'Deutschland',
  eu: 'EU',
  int: 'International',
};

export const CONFIDENCE_LABELS: Record<ArticleData['confidence'], string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
};

export const STRENGTH_LABELS: Record<ArticleData['primarySourceStrength'], string> = {
  none: 'Keine',
  weak: 'Schwach',
  medium: 'Mittel',
  strong: 'Stark',
};

export const RISK_LABELS: Record<ArticleData['framingRisk'], string> = {
  low: 'Gering',
  medium: 'Mittel',
  high: 'Hoch',
};

export const CLAIM_STATUS: Record<Claim['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' | 'danger' }> = {
  supported: { label: 'Belegt', tone: 'ok' },
  partial: { label: 'Teilweise', tone: 'warn' },
  unclear: { label: 'Unklar', tone: 'neutral' },
  contradicted: { label: 'Widersprochen', tone: 'danger' },
};

export const SOURCE_TYPE_LABELS: Record<Source['type'], string> = {
  agency: 'Agentur',
  media: 'Medium',
  primary: 'Primärquelle',
  official: 'Amtlich',
  study: 'Studie',
  press_release: 'Aussendung',
  other: 'Sonstige',
};

/** Quellentypen, die als Primärquellen gruppiert werden. */
const PRIMARY_TYPES: ReadonlySet<Source['type']> = new Set(['primary', 'official', 'study', 'press_release']);

export function isPrimarySource(source: Source): boolean {
  return PRIMARY_TYPES.has(source.type);
}

/** Sichtbar in Listen (Startseite, Themen, RSS, Weiterlesen). */
export function isListed(article: Article): boolean {
  return article.data.status === 'published' || article.data.status === 'corrected';
}

/** Baubar als Seite (Direkt-URL). draft/review werden nie gebaut. */
export function isBuilt(article: Article): boolean {
  return isListed(article) || article.data.status === 'retracted' || article.data.status === 'archived';
}

export function byNewest(a: Article, b: Article): number {
  return (b.data.publishedAt?.getTime() ?? 0) - (a.data.publishedAt?.getTime() ?? 0);
}

/** Relevanz-Ranking für Aufmacher + Top-Stories (PLAN.md E38). Deterministisch pro Build. */
const CONFIDENCE_SCORE: Record<ArticleData['confidence'], number> = { low: 0, medium: 0.5, high: 1 };
const STRENGTH_SCORE: Record<ArticleData['primarySourceStrength'], number> = { none: 0, weak: 1 / 3, medium: 2 / 3, strong: 1 };
// Geografische Nähe (E52): dämpft die Basis-Qualität multiplikativ, damit ein
// reines Auslandsereignis die AT-Leserschaft nicht allein über hohe
// Newsworthiness in den Aufmacher drängt. Wirkt NUR auf `base` — Medienecho
// (E46) bleibt unberührt, damit eine breite Welle eine Story weiter heben kann.
const PROXIMITY_SCORE: Record<ArticleData['country'], number> = { at: 1, de: 0.85, eu: 0.75, int: 0.5 };
const RELEVANCE_HALF_LIFE_DAYS = 3;
// Resonanz (E46): Medienecho hebt additiv — volle Welle (Level 5, frisch) ≈ +3,5
// Newsworthiness-Stufen. Kalibriert an echten Scores: muss den Quality-Abstand
// eines News-3/weak-Artikels zu einem gleichtags erschienenen News-5-Aufmacher
// (~0,33) überbrücken. Eigener, kürzerer Decay: Welle ebbt binnen Tagen ab.
const RESONANCE_WEIGHT = 0.35;
const RESONANCE_HALF_LIFE_DAYS = 1;
// Statische Site: einmal pro Build ausgewertet, damit alle Vergleiche konsistent sind.
const BUILD_NOW = Date.now();

export function relevanceScore(article: Article, now: number = BUILD_NOW): number {
  const d = article.data;
  // updatedAt ?? publishedAt — substanzielle Updates frischen den Score bewusst wieder auf.
  const ref = lastUpdated(d);
  if (!ref) return 0;

  const news = (d.newsworthiness - 1) / 4;
  const { supported, total } = claimStats(d.claims);
  const supportedRatio = total > 0 ? supported / total : 0;
  const sourceCount = Math.min(d.sources.length, 5) / 5;
  const hasPrimary = d.sources.some(isPrimarySource);
  const hasSecondary = d.sources.some((s) => !isPrimarySource(s));
  const diversity = hasPrimary && hasSecondary ? 1 : 0.5;

  const quality =
    0.4 * news +
    0.15 * CONFIDENCE_SCORE[d.confidence] +
    0.15 * STRENGTH_SCORE[d.primarySourceStrength] +
    0.1 * sourceCount +
    0.1 * diversity +
    0.1 * supportedRatio;

  const ageDays = Math.max(0, (now - ref.getTime()) / 86_400_000);
  const base = quality * Math.pow(0.5, ageDays / RELEVANCE_HALF_LIFE_DAYS) * PROXIMITY_SCORE[d.country];

  // Resonanz (E46): additiv, damit eine Welle auch Artikel mit schwacher
  // Quellenlage in den Aufmacher heben kann — bewusste Entscheidung, die
  // Metriken stehen sichtbar daneben.
  if (!d.resonance) return base;
  const resonanceAgeDays = Math.max(0, (now - d.resonance.measuredAt.getTime()) / 86_400_000);
  const echo =
    RESONANCE_WEIGHT * ((d.resonance.level - 1) / 4) * Math.pow(0.5, resonanceAgeDays / RESONANCE_HALF_LIFE_DAYS);
  return base + echo;
}

/** Badge „Breites Echo" (E46): starkes, frisch gemessenes Medienecho. */
export function hasBroadEcho(article: Article, now: number = BUILD_NOW): boolean {
  const r = article.data.resonance;
  return !!r && r.level >= 4 && now - r.measuredAt.getTime() < 48 * 3_600_000;
}

export function byRelevance(a: Article, b: Article): number {
  return relevanceScore(b) - relevanceScore(a) || byNewest(a, b) || a.id.localeCompare(b.id);
}

export function lastUpdated(data: ArticleData): Date | undefined {
  return data.updatedAt ?? data.publishedAt;
}

export function claimStats(claims: Claim[]): { supported: number; total: number } {
  return {
    supported: claims.filter((c) => c.status === 'supported').length,
    total: claims.length,
  };
}

/** Meter-Füllstand (0–5 Segmente). */
export const STRENGTH_METER: Record<ArticleData['primarySourceStrength'], number> = {
  none: 0,
  weak: 1,
  medium: 3,
  strong: 5,
};

export const LEVEL_METER: Record<'low' | 'medium' | 'high', number> = {
  low: 1,
  medium: 3,
  high: 5,
};

const DATE_FORMAT = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Vienna',
});

export function formatDate(date: Date): string {
  return DATE_FORMAT.format(date);
}
