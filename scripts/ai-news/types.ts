/**
 * Gemeinsame Typen der AI-News-Pipeline (PLAN.md Entscheidungen 25–36).
 */

export interface SourceDef {
  id: string;
  name: string;
  type: 'media' | 'press_release_wire';
  country: string;
  language: string;
  url: string;
  usage: string;
  enabled: boolean;
  weight: number;
  validation?: string;
}

export interface SourceRegistry {
  version: number;
  updatedAt: string;
  notes?: string[];
  sources: SourceDef[];
}

export interface FeedItem {
  id: string; // sha256(sourceId + normalizedUrl)
  sourceId: string;
  sourceName: string;
  sourceType: SourceDef['type'];
  title: string;
  url: string;
  publishedAt?: string;
  fetchedAt: string;
  summary?: string;
  categories?: string[];
}

export interface SeenItem {
  firstSeenAt: string;
  lastSeenAt: string;
  sourceId: string;
  sourceType: SourceDef['type'];
  title: string;
  url: string;
  clusterId?: string;
}

export interface SeenItems {
  version: number;
  updatedAt: string;
  items: Record<string, SeenItem>;
}

export interface Story {
  canonicalTitle: string;
  slug: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  /** 'review' wird nicht mehr geschrieben (Review-PR-Flow entfernt) — nur Legacy-Einträge. */
  status: 'monitor' | 'noted' | 'published' | 'review';
  articlePath?: string;
  researchPath?: string;
  sourceUrls: string[];
  openQuestions: string[];
  sensitivity?: 'low' | 'medium' | 'high';
  doNotRedraftBefore?: string;
  doNotUpdateBefore?: string;
  /**
   * Resonanz-Zählung (E46): Publisher-Kürzel (portalOf) → Zeitpunkt des letzten
   * neuen Story-Matches. Rollierendes Fenster (AI_NEWS_RESONANCE_WINDOW_HOURS),
   * alte Einträge werden pro Run ausgedünnt.
   */
  echoPublishers?: Record<string, string>;
  /** Zuletzt festgestelltes Resonanz-Level (1–5; 1 = neutral, steht nie im Frontmatter). */
  resonanceLevel?: number;
  /** Wer zuletzt gemessen hat — Haiku-Urteil (triage) hält 24 h gegen die Zählung (E46). */
  resonanceSource?: 'zaehlung' | 'triage';
  resonanceMeasuredAt?: string;
}

export interface StoryMemory {
  version: number;
  updatedAt: string;
  stories: Record<string, Story>;
}

export interface SourceHealthEntry {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastStatus: 'ok' | 'failed' | 'skipped';
  lastItemCount?: number;
  lastError?: string;
}

export interface SourceHealth {
  sources: Record<string, SourceHealthEntry>;
}

export interface RunRecord {
  runId: string;
  fetched: number;
  feedErrors: number;
  newItems: number;
  clusters: number;
  aiTriaged: number;
  drafts: number;
  updates: number;
  notes: number;
  webSearchCalls: number;
  errors: number;
  /** Aus dem Backlog übernommene Cluster (Cap-Überlauf/Fehler voriger Runs). */
  carriedOver?: number;
  /** Am Run-Ende in den Backlog geschriebene Cluster. */
  backlogged?: number;
  /** Artikel, deren resonance-Frontmatter dieser Run geändert hat (E46). */
  resonanceUpdates?: number;
}

export interface Cluster {
  id: string;
  title: string;
  tokens: Set<string>;
  items: ClusterItem[];
}

export interface ClusterItem {
  itemId: string;
  sourceId: string;
  sourceType: SourceDef['type'];
  title: string;
  url: string;
  summary?: string;
  publishedAt?: string;
  isNew: boolean;
  /** Vor der Triage abgerufener Volltext-Auszug (nur Beurteilung, nie Nachdruck). */
  fulltext?: string;
}

/**
 * Cap-/Fehler-Überlauf der Triage: Cluster, die über der Schwelle lagen,
 * aber diesen Run nicht triaged wurden — nächster Run zieht sie wieder in
 * die Queue, bis sie triaged sind oder aus dem Lookback-Fenster altern.
 */
export interface TriageBacklogEntry {
  clusterId: string;
  title: string;
  score: number;
  items: ClusterItem[];
  queuedAt: string;
}

export interface TriageBacklog {
  version: number;
  updatedAt: string;
  entries: TriageBacklogEntry[];
}

export interface ClusterScore {
  score: number;
  recommendedAction: 'ignore' | 'monitor' | 'ai_triage';
  reasons: string[];
}

export type Sensitivity = 'low' | 'medium' | 'high';

export interface TriageResult {
  action: 'ignore' | 'monitor' | 'research_note' | 'draft_article' | 'update_story';
  reason: string;
  sensitivity: Sensitivity;
  /** Nachrichtenwert 1–5 (PLAN.md E38), landet im Artikel-Frontmatter. */
  newsworthiness: number;
  /**
   * Resonanz-Urteil 1–5 (E46), nur wenn relatedStory einen publizierten Artikel
   * hat — beurteilt Echo-Qualität (Agentur-Syndikation zählt als EIN Echo) und
   * überschreibt die deterministische Zählung für 24 h. Sonst null/fehlend.
   */
  resonance?: number | null;
  possibleClaims: string[];
  missingSources: string[];
}

export interface DraftBodySection {
  heading: string;
  markdown: string;
}

/**
 * Bild-Kandidat (PLAN.md E44): offizielles Pressefoto mit ausdrücklichem
 * Nutzungsrecht — kommt aus der kuratierten Whitelist
 * (data/ai-news/image-sources.yaml) oder einem Backfill-Vorschlag.
 * termsQuote = wörtliches Zitat des erlaubenden Satzes (Beweissicherung).
 */
export interface DraftImage {
  downloadUrl: string;
  alt: string;
  caption: string;
  kind: 'symbol' | 'direct';
  credit: {
    author: string;
    license: string;
    sourceUrl: string;
    termsUrl: string;
    termsQuote: string;
  };
}

export interface DraftResult {
  slugSuggestion: string;
  title: string;
  description: string;
  topic: 'politik' | 'wirtschaft' | 'gesellschaft' | 'technologie' | 'wissenschaft';
  country: 'at' | 'de' | 'eu' | 'int';
  confidence: 'low' | 'medium' | 'high';
  confidenceNote: string;
  primarySourceStrength: 'none' | 'weak' | 'medium' | 'strong';
  sourceStrengthNote: string;
  framingRisk: 'low' | 'medium' | 'high';
  framingRiskNote: string;
  sensitivity: Sensitivity;
  summary: { text: string; kind: 'fact' | 'open' }[];
  openQuestions: string[];
  sources: {
    id: string;
    name: string;
    type: 'agency' | 'media' | 'primary' | 'official' | 'study' | 'press_release' | 'other';
    url: string;
  }[];
  claims: {
    id: string;
    text: string;
    status: 'supported' | 'partial' | 'unclear' | 'contradicted';
    note?: string;
    sourceIds: string[];
  }[];
  body: DraftBodySection[];
  /** Kompakt-Fassung: reiner Fließtext, 2–3 Absätze, keine Überschriften (PLAN.md E37). */
  bodyKompakt: string;
  /** Nur beim Update: Text für den corrections-Eintrag (type: update). */
  updateNote?: string;
}

export interface ManifestArticle {
  slug: string;
  articlePath: string;
  /** Repo-relativer Pfad des Research-JSONs (Audit-Beleg, wird mit committet). */
  researchPath: string;
  /** Repo-relativer Pfad des Hero-Bilds (E44). */
  imagePath?: string;
  isUpdate: boolean;
}

export interface RunManifest {
  ranAt: string;
  /**
   * 'published_new' sobald mindestens ein neuer Artikel dabei ist;
   * 'resonance_update' wenn nur resonance-Frontmatter geändert wurde —
   * beides Deploy-Trigger (E46).
   */
  action: 'none' | 'published_new' | 'published_update' | 'resonance_update';
  /** Alle Artikel dieses Runs (max AI_NEWS_MAX_ARTICLES_PER_RUN). */
  articles: ManifestArticle[];
  slug?: string;
  articlePath?: string;
  stats: RunRecord;
}
