import type { CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;
export type ArticleData = Article['data'];
export type Source = ArticleData['sources'][number];
export type Claim = ArticleData['claims'][number];

export const TOPICS = ['politik', 'wirtschaft', 'gesellschaft', 'technologie', 'wissenschaft'] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  politik: 'Politik',
  wirtschaft: 'Wirtschaft',
  gesellschaft: 'Gesellschaft',
  technologie: 'Technologie',
  wissenschaft: 'Wissenschaft',
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
