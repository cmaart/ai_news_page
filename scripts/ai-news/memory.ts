/**
 * Rolling Memory (PLAN.md E27): JSON-Dateien unter data/ai-news/memory/,
 * werden vom Workflow direkt auf main committet. Retention wird bei jedem
 * Speichern angewandt.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunRecord, SeenItems, SourceHealth, StoryMemory } from './types.ts';
import { hoursAgo, isoNow } from './util.ts';

export const DATA_DIR = join(process.cwd(), 'data', 'ai-news');
export const MEMORY_DIR = join(DATA_DIR, 'memory');
export const WORK_DIR = join(DATA_DIR, 'work'); // gitignored: Debug-Output + Manifest

const SEEN_ITEMS_PATH = join(MEMORY_DIR, 'seen-items.json');
const STORY_MEMORY_PATH = join(MEMORY_DIR, 'story-memory.json');
const SOURCE_HEALTH_PATH = join(MEMORY_DIR, 'source-health.json');
const RUN_HISTORY_PATH = join(MEMORY_DIR, 'run-history.jsonl');

const SEEN_RETENTION_HOURS = 30 * 24;
const STORY_RETENTION_HOURS = 180 * 24;
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
