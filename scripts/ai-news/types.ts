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
  status: 'monitor' | 'noted' | 'published' | 'review';
  articlePath?: string;
  researchPath?: string;
  sourceUrls: string[];
  openQuestions: string[];
  sensitivity?: 'low' | 'medium' | 'high';
  doNotRedraftBefore?: string;
  doNotUpdateBefore?: string;
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
  possibleClaims: string[];
  missingSources: string[];
}

export interface DraftBodySection {
  heading: string;
  markdown: string;
}

export interface DraftResult {
  slugSuggestion: string;
  title: string;
  description: string;
  topic: 'politik' | 'wirtschaft' | 'gesellschaft' | 'technologie' | 'wissenschaft';
  country: 'at' | 'de' | 'eu' | 'int';
  confidence: 'low' | 'medium' | 'high';
  primarySourceStrength: 'none' | 'weak' | 'medium' | 'strong';
  framingRisk: 'low' | 'medium' | 'high';
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
  /** Nur beim Update: Text für den corrections-Eintrag (type: update). */
  updateNote?: string;
}

export interface RunManifest {
  ranAt: string;
  action: 'none' | 'published_new' | 'published_update' | 'review_new' | 'review_update';
  slug?: string;
  articlePath?: string;
  sensitive: boolean;
  stats: RunRecord;
}
