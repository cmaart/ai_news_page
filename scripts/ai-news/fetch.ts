/**
 * Phase 1: RSS-Fetch (discovery-only). Nur enabled-Feeds, Timeout pro Feed,
 * max. Items pro Feed, Fehler landen in source-health — nie im Job-Fail.
 */
import Parser from 'rss-parser';
import type { FeedItem, SourceDef, SourceHealth } from './types.ts';
import { envInt, isoNow, itemId, normalizeUrl } from './util.ts';

const FEED_TIMEOUT_MS = envInt('AI_NEWS_FEED_TIMEOUT_MS', 10_000);
const MAX_ITEMS_PER_FEED = envInt('AI_NEWS_MAX_ITEMS_PER_FEED', 50);
const USER_AGENT = 'neue-nachrichten-research/1.0 (+https://github.com/cmaart/ai_news_page)';

// Backoff für dauerhaft kaputte Feeds: ab 24 Fehlern nur noch jeder 12. Versuch.
const BACKOFF_AFTER_FAILURES = 24;
const BACKOFF_RETRY_EVERY = 12;

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
});

export interface FetchOutcome {
  items: FeedItem[];
  fetched: number;
  feedErrors: number;
}

export async function fetchAllFeeds(sources: SourceDef[], health: SourceHealth): Promise<FetchOutcome> {
  const enabled = sources.filter((s) => s.enabled);
  const results = await Promise.all(enabled.map((source) => fetchFeed(source, health)));
  const items = results.flat();
  const feedErrors = enabled.filter((s) => health.sources[s.id]?.lastStatus === 'failed').length;
  return { items, fetched: items.length, feedErrors };
}

async function fetchFeed(source: SourceDef, health: SourceHealth): Promise<FeedItem[]> {
  const entry = (health.sources[source.id] ??= {
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastStatus: 'ok',
  });

  if (
    entry.consecutiveFailures >= BACKOFF_AFTER_FAILURES &&
    (entry.consecutiveFailures - BACKOFF_AFTER_FAILURES) % BACKOFF_RETRY_EVERY !== 0
  ) {
    entry.consecutiveFailures += 1;
    entry.lastStatus = 'skipped';
    return [];
  }

  try {
    const feed = await parser.parseURL(source.url);
    const fetchedAt = isoNow();
    const items: FeedItem[] = [];
    for (const raw of (feed.items ?? []).slice(0, MAX_ITEMS_PER_FEED)) {
      const title = raw.title?.trim();
      const link = raw.link?.trim();
      if (!title || !link) continue;
      items.push({
        id: itemId(source.id, link, title, raw.isoDate ?? raw.pubDate),
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        title,
        url: normalizeUrl(link),
        publishedAt: raw.isoDate ?? undefined,
        fetchedAt,
        summary: raw.contentSnippet?.trim().slice(0, 500) || undefined,
        categories: raw.categories?.map(String).slice(0, 8),
      });
    }
    entry.lastSuccessAt = fetchedAt;
    entry.consecutiveFailures = 0;
    entry.lastStatus = 'ok';
    entry.lastItemCount = items.length;
    delete entry.lastError;
    return items;
  } catch (error) {
    entry.lastFailureAt = isoNow();
    entry.consecutiveFailures += 1;
    entry.lastStatus = 'failed';
    entry.lastError = (error as Error).message?.slice(0, 200);
    console.warn(`Feed-Fehler ${source.id}: ${entry.lastError}`);
    return [];
  }
}
