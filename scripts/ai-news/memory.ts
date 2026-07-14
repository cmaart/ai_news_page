/**
 * Rolling Memory (PLAN.md E27): JSON-Dateien unter data/ai-news/memory/,
 * werden vom Workflow direkt auf main committet. Retention wird bei jedem
 * Speichern angewandt.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunRecord, SeenItems, SourceHealth, StoryMemory, TriageBacklog } from './types.ts';
import { hoursAgo, isoNow } from './util.ts';

export const DATA_DIR = join(process.cwd(), 'data', 'ai-news');
export const MEMORY_DIR = join(DATA_DIR, 'memory');
export const WORK_DIR = join(DATA_DIR, 'work'); // gitignored: Debug-Output + Manifest

const SEEN_ITEMS_PATH = join(MEMORY_DIR, 'seen-items.json');
const STORY_MEMORY_PATH = join(MEMORY_DIR, 'story-memory.json');
const SOURCE_HEALTH_PATH = join(MEMORY_DIR, 'source-health.json');
const RUN_HISTORY_PATH = join(MEMORY_DIR, 'run-history.jsonl');
const TRIAGE_BACKLOG_PATH = join(MEMORY_DIR, 'triage-backlog.json');

const SEEN_RETENTION_HOURS = 30 * 24;
// E54: 180 d → 30 d. story-memory ist reines Working-Set (Dedup via matchStory,
// Resonanz-24-h-Fenster, Redraft-/Update-Throttles, noted/monitor-Watch-List).
// Backlinks/Delta-Bezüge kommen jetzt aus dem permanenten Artikel-Index auf der
// Platte (article.ts loadArticleIndex) — jeden Alters, unabhängig von dieser
// Retention. Die Platten-Suche backstoppt auch Dedup jenseits von 30 d.
const STORY_RETENTION_HOURS = 30 * 24;
const RUN_HISTORY_MAX = 500;

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function loadSeenItems(): SeenItems {
  return readJson<SeenItems>(SEEN_ITEMS_PATH, { version: 1, updatedAt: isoNow(), items: {} });
}

export function saveSeenItems(seen: SeenItems): void {
  const cutoff = hoursAgo(SEEN_RETENTION_HOURS).toISOString();
  for (const [id, item] of Object.entries(seen.items)) {
    if (item.lastSeenAt < cutoff) delete seen.items[id];
  }
  seen.updatedAt = isoNow();
  writeJson(SEEN_ITEMS_PATH, seen);
}

export function loadStoryMemory(): StoryMemory {
  return readJson<StoryMemory>(STORY_MEMORY_PATH, { version: 1, updatedAt: isoNow(), stories: {} });
}

export function saveStoryMemory(memory: StoryMemory): void {
  const cutoff = hoursAgo(STORY_RETENTION_HOURS).toISOString();
  for (const [slug, story] of Object.entries(memory.stories)) {
    if (story.lastUpdatedAt < cutoff) delete memory.stories[slug];
  }
  memory.updatedAt = isoNow();
  writeJson(STORY_MEMORY_PATH, memory);
}

export function loadTriageBacklog(): TriageBacklog {
  return readJson<TriageBacklog>(TRIAGE_BACKLOG_PATH, { version: 1, updatedAt: isoNow(), entries: [] });
}

/** Retention: Einträge älter als das Lookback-Fenster sind keine News mehr. */
export function saveTriageBacklog(backlog: TriageBacklog, maxAgeHours: number): void {
  const cutoff = hoursAgo(maxAgeHours).toISOString();
  backlog.entries = backlog.entries.filter((e) => e.queuedAt >= cutoff);
  backlog.updatedAt = isoNow();
  writeJson(TRIAGE_BACKLOG_PATH, backlog);
}

export function loadSourceHealth(): SourceHealth {
  return readJson<SourceHealth>(SOURCE_HEALTH_PATH, { sources: {} });
}

export function saveSourceHealth(health: SourceHealth): void {
  writeJson(SOURCE_HEALTH_PATH, health);
}

export function loadRunHistory(): RunRecord[] {
  if (!existsSync(RUN_HISTORY_PATH)) return [];
  return readFileSync(RUN_HISTORY_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunRecord);
}

export function appendRunHistory(record: RunRecord): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  const existing = loadRunHistory();
  existing.push(record);
  const trimmed = existing.slice(-RUN_HISTORY_MAX);
  writeFileSync(RUN_HISTORY_PATH, `${trimmed.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

/** Web-Search-Calls des heutigen UTC-Tages aus der Run-History (Tages-Deckel E28). */
export function webSearchCallsToday(history: RunRecord[], todayStamp: string): number {
  return history
    .filter((r) => r.runId.startsWith(todayStamp))
    .reduce((sum, r) => sum + (r.webSearchCalls ?? 0), 0);
}

export function writeWorkFile(name: string, value: unknown): void {
  writeJson(join(WORK_DIR, name), value);
}

export function appendErrorNote(dateStamp: string, name: string, payload: unknown): void {
  const path = join(DATA_DIR, 'notes', dateStamp, `${name}.json`);
  writeJson(path, payload);
}
