/**
 * Orchestrator der AI-News-Pipeline (PLAN.md E25–E36).
 *
 * Ablauf pro Run: RSS-Fetch → Dedupe (seen-items) → Clustering → Scoring →
 * Haiku-Triage (max 5) → max 1 Sonnet-Draft/-Update → MDX + Research-JSON →
 * Memory-Update → Manifest für den Workflow (Commit/PR passiert dort).
 *
 * Aufruf: npm run ai-news:run [-- --dry-run]
 *   --dry-run: Fetch/Cluster/Score + Report, keine Claude-Calls, keine Writes.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { readExistingArticle, resolveSlug, writeArticle } from './article.ts';
import { draftOrUpdate, triageCluster } from './claude.ts';
import { buildClusters } from './cluster.ts';
import { fetchAllFeeds } from './fetch.ts';
import {
  DATA_DIR,
  appendErrorNote,
  appendRunHistory,
  loadRunHistory,
  loadSeenItems,
  loadSourceHealth,
  loadStoryMemory,
  saveSeenItems,
  saveSourceHealth,
  saveStoryMemory,
  webSearchCallsToday,
  writeJson,
  writeWorkFile,
} from './memory.ts';
import { scoreCluster } from './score.ts';
import type {
  Cluster,
  ClusterScore,
  DraftResult,
  RunManifest,
  RunRecord,
  SourceRegistry,
  Story,
  TriageResult,
} from './types.ts';
import { envInt, isoNow, jaccard, portalOf, titleTokens, utcDateStamp } from './util.ts';

const MAX_TRIAGE_PER_RUN = envInt('AI_NEWS_MAX_TRIAGE', 5);
const MAX_WEB_SEARCH_PER_DAY = envInt('AI_NEWS_MAX_WEB_SEARCH_PER_DAY', 8);
const LOOKBACK_HOURS = envInt('AI_NEWS_LOOKBACK_HOURS', 48);
const REDRAFT_LOCK_HOURS = envInt('AI_NEWS_REDRAFT_LOCK_HOURS', 24);
const UPDATE_THROTTLE_HOURS = envInt('AI_NEWS_UPDATE_THROTTLE_HOURS', 6);
const WEB_SEARCH_MIN_PORTALS = envInt('AI_NEWS_WEB_SEARCH_MIN_PORTALS', 3);

const dryRun = process.argv.includes('--dry-run') || process.env.AI_NEWS_DRY_RUN === '1';

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const dateStamp = utcDateStamp(now);

  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY fehlt — Abbruch (für Tests: --dry-run).');
    process.exit(1);
  }

  const registry = parse(readFileSync(join(DATA_DIR, 'sources.yaml'), 'utf8')) as SourceRegistry;
  const sourceById = new Map(registry.sources.map((s) => [s.id, s]));
  const seen = loadSeenItems();
  const stories = loadStoryMemory();
  const health = loadSourceHealth();
  const history = loadRunHistory();

  const stats: RunRecord = {
    runId: nowIso,
    fetched: 0,
    feedErrors: 0,
    newItems: 0,
    clusters: 0,
    aiTriaged: 0,
    drafts: 0,
    updates: 0,
    notes: 0,
    webSearchCalls: 0,
    errors: 0,
  };

  // Phase 1+2: Fetch + Dedupe -----------------------------------------------
  const { items, fetched, feedErrors } = await fetchAllFeeds(registry.sources, health);
  stats.fetched = fetched;
  stats.feedErrors = feedErrors;

  const newItems = items.filter((item) => !seen.items[item.id]);
  stats.newItems = newItems.length;
  for (const item of items) {
    const existing = seen.items[item.id];
    if (existing) {
      existing.lastSeenAt = item.fetchedAt;
    } else {
      seen.items[item.id] = {
        firstSeenAt: item.fetchedAt,
        lastSeenAt: item.fetchedAt,
        sourceId: item.sourceId,
        sourceType: item.sourceType,
        title: item.title,
        url: item.url,
      };
    }
  }

  // Phase 3+4: Clustering + Scoring -----------------------------------------
  const clusters = buildClusters(newItems, seen, LOOKBACK_HOURS);
  stats.clusters = clusters.length;

  const scored = clusters
    .map((cluster) => ({ cluster, score: scoreCluster(cluster, sourceById) }))
    .sort((a, b) => b.score.score - a.score.score);

  for (const { cluster } of scored) {
    for (const item of cluster.items) {
      const entry = seen.items[item.itemId];
      if (entry) entry.clusterId = cluster.id;
    }
  }

  writeWorkFile(`inbox-${dateStamp}.json`, newItems);
  writeWorkFile(
    `clusters-${dateStamp}.json`,
    scored.map(({ cluster, score }) => ({
      id: cluster.id,
      title: cluster.title,
      score,
      items: cluster.items.map((i) => ({ source: i.sourceId, title: i.title, url: i.url, isNew: i.isNew })),
    })),
  );

  console.log(`Fetch: ${fetched} Items (${feedErrors} Feed-Fehler) · neu: ${newItems.length} · Cluster: ${clusters.length}`);
  for (const { cluster, score } of scored.slice(0, 10)) {
    console.log(`  [${score.score}] ${score.recommendedAction} — ${cluster.title} (${cluster.items.length} Items)`);
  }

  let manifest: RunManifest = { ranAt: nowIso, action: 'none', sensitive: false, stats };

  if (dryRun) {
    console.log('Dry-Run — keine Claude-Calls, keine Writes.');
    writeWorkFile('run-output.json', manifest);
    return;
  }

  // Phase 5: Triage (Haiku, max 5) ------------------------------------------
  const triageCandidates = scored.filter(({ score }) => score.recommendedAction === 'ai_triage');
  const triaged: { cluster: Cluster; score: ClusterScore; triage: TriageResult; story?: Story }[] = [];

  for (const { cluster, score } of triageCandidates.slice(0, MAX_TRIAGE_PER_RUN)) {
    const story = matchStory(cluster, stories);
    try {
      const triage = await triageCluster(cluster, story);
      triaged.push({ cluster, score, triage, story });
      stats.aiTriaged += 1;
      console.log(`Triage [${triage.action}/${triage.sensitivity}] ${cluster.title} — ${triage.reason}`);
    } catch (error) {
      stats.errors += 1;
      appendErrorNote(dateStamp, `triage-error-${cluster.id}`, {
        type: 'error_note',
        stage: 'triage',
        clusterId: cluster.id,
        clusterTitle: cluster.title,
        error: (error as Error).message,
        createdAt: nowIso,
      });
    }
  }

  // Phase 6: max 1 Draft/Update (Sonnet) -------------------------------------
  const searchBudget = Math.max(0, MAX_WEB_SEARCH_PER_DAY - webSearchCallsToday(history, dateStamp));
  let acted = false;

  for (const entry of triaged) {
    const { cluster, triage } = entry;
    let story = entry.story;

    // Story existiert ⇒ nie neuer Artikel (E31); ohne Story ist update ein Draft.
    let action = triage.action;
    if (story && action === 'draft_article') action = 'update_story';
    if (!story && action === 'update_story') action = 'draft_article';

    if (action === 'research_note') {
      appendErrorNote(dateStamp, `note-${cluster.id}`, {
        type: 'research_note',
        clusterId: cluster.id,
        clusterTitle: cluster.title,
        reason: triage.reason,
        sensitivity: triage.sensitivity,
        possibleClaims: triage.possibleClaims,
        missingSources: triage.missingSources,
        createdAt: nowIso,
      });
      stats.notes += 1;
      noteStory(stories, cluster, triage, nowIso);
      continue;
    }

    if (action !== 'draft_article' && action !== 'update_story') continue;
    if (acted) continue; // max 1 Story pro Run — Rest bleibt monitor.

    const isUpdate = action === 'update_story' && !!story;
    if (isUpdate && story!.doNotUpdateBefore && story!.doNotUpdateBefore > nowIso) {
      console.log(`Update-Throttle aktiv für ${story!.slug} — übersprungen.`);
      continue;
    }
    if (!isUpdate) {
      const lockedStory = matchStory(cluster, stories);
      if (lockedStory?.doNotRedraftBefore && lockedStory.doNotRedraftBefore > nowIso) continue;
    }

    const portals = new Set(cluster.items.map((i) => portalOf(i.sourceId)));
    const useWebSearch = searchBudget > 0 && (isUpdate || portals.size >= WEB_SEARCH_MIN_PORTALS);

    const existingArticle = isUpdate ? readExistingArticle(story!.slug) : null;

    try {
      const { draft, webSearchUsed } = await draftOrUpdate({
        cluster,
        triage,
        existingArticle: existingArticle
          ? { slug: story!.slug, frontmatterYaml: existingArticle.frontmatterYaml, body: existingArticle.body }
          : undefined,
        useWebSearch,
      });
      stats.webSearchCalls += webSearchUsed;

      const sanitized = sanitizeDraft(draft);
      if (!sanitized) {
        throw new Error('Draft unbrauchbar: keine gültigen Quellen oder leerer Body.');
      }

      const sensitive = triage.sensitivity === 'high' || sanitized.sensitivity === 'high';
      const status: 'published' | 'review' = sensitive ? 'review' : 'published';
      const slug = isUpdate ? story!.slug : resolveSlug(sanitized.slugSuggestion, sanitized.title);

      const existingFm = existingArticle?.frontmatter as
        | { publishedAt?: string | Date; corrections?: { date: string | Date; type: 'correction' | 'update'; text: string }[] }
        | undefined;

      const articlePath = writeArticle({
        slug,
        draft: sanitized,
        // Update eines published-Artikels bleibt published; sensitiv ⇒ review-PR.
        status: isUpdate && !sensitive ? 'published' : status,
        publishedAt: existingFm?.publishedAt ? new Date(existingFm.publishedAt).toISOString() : undefined,
        existingCorrections: (existingFm?.corrections ?? []).map((c) => ({
          date: new Date(c.date).toISOString(),
          type: c.type,
          text: c.text,
        })),
        updateNote: isUpdate ? (sanitized.updateNote ?? 'Artikel um neue Quellen ergänzt.') : undefined,
        nowIso,
      });

      const researchPath = join(DATA_DIR, 'research', dateStamp, `${slug}${isUpdate ? `-update-${now.getUTCHours()}00` : ''}.json`);
      writeJson(researchPath, {
        cluster: { id: cluster.id, title: cluster.title, items: cluster.items },
        triage,
        draft: sanitized,
        webSearchUsed,
        createdAt: nowIso,
      });

      story = upsertStory(stories, {
        slug,
        cluster,
        draft: sanitized,
        status: sensitive ? 'review' : 'published',
        articlePath,
        researchPath: relative(process.cwd(), researchPath).replace(/\\/g, '/'),
        nowIso,
        redraftLockHours: REDRAFT_LOCK_HOURS,
        updateThrottleHours: UPDATE_THROTTLE_HOURS,
      });

      if (isUpdate) stats.updates += 1;
      else stats.drafts += 1;
      acted = true;

      manifest = {
        ranAt: nowIso,
        action: sensitive ? (isUpdate ? 'review_update' : 'review_new') : isUpdate ? 'published_update' : 'published_new',
        slug,
        articlePath,
        sensitive,
        stats,
      };
      console.log(`${isUpdate ? 'Update' : 'Draft'} geschrieben: ${articlePath} (${sensitive ? 'review/PR' : 'auto-publish'})`);
    } catch (error) {
      stats.errors += 1;
      appendErrorNote(dateStamp, `draft-error-${cluster.id}`, {
        type: 'error_note',
        stage: isUpdate ? 'update' : 'draft',
        clusterId: cluster.id,
        clusterTitle: cluster.title,
        error: (error as Error).message,
        createdAt: nowIso,
      });
      console.error(`Draft/Update fehlgeschlagen für ${cluster.title}: ${(error as Error).message}`);
    }
  }

  // Phase 7: Memory + Manifest -----------------------------------------------
  saveSeenItems(seen);
  saveStoryMemory(stories);
  saveSourceHealth(health);
  appendRunHistory(stats);
  manifest.stats = stats;
  writeWorkFile('run-output.json', manifest);
  console.log(`Run fertig: ${JSON.stringify(stats)}`);
}

// ---------------------------------------------------------------------------

function matchStory(cluster: Cluster, memory: { stories: Record<string, Story> }): Story | undefined {
  const urls = new Set(cluster.items.map((i) => i.url));
  const clusterTokens = titleTokens(cluster.title);
  for (const story of Object.values(memory.stories)) {
    if (story.sourceUrls.some((u) => urls.has(u))) return story;
    if (jaccard(clusterTokens, titleTokens(story.canonicalTitle)) >= 0.5) return story;
  }
  return undefined;
}

function noteStory(memory: { stories: Record<string, Story> }, cluster: Cluster, triage: TriageResult, nowIso: string): void {
  const existing = matchStory(cluster, memory);
  if (existing) {
    existing.lastUpdatedAt = nowIso;
    existing.sourceUrls = [...new Set([...existing.sourceUrls, ...cluster.items.map((i) => i.url)])];
    existing.openQuestions = [...new Set([...existing.openQuestions, ...triage.missingSources])];
    return;
  }
  const slug = cluster.id;
  memory.stories[slug] = {
    canonicalTitle: cluster.title,
    slug,
    firstSeenAt: nowIso,
    lastUpdatedAt: nowIso,
    status: 'noted',
    sourceUrls: cluster.items.map((i) => i.url),
    openQuestions: triage.missingSources,
    sensitivity: triage.sensitivity,
  };
}

function upsertStory(
  memory: { stories: Record<string, Story> },
  options: {
    slug: string;
    cluster: Cluster;
    draft: DraftResult;
    status: 'published' | 'review';
    articlePath: string;
    researchPath: string;
    nowIso: string;
    redraftLockHours: number;
    updateThrottleHours: number;
  },
): Story {
  const { slug, cluster, draft, status, articlePath, researchPath, nowIso } = options;
  const previous = memory.stories[slug] ?? matchStory(cluster, memory);
  if (previous && previous.slug !== slug) delete memory.stories[previous.slug];

  const story: Story = {
    canonicalTitle: draft.title,
    slug,
    firstSeenAt: previous?.firstSeenAt ?? nowIso,
    lastUpdatedAt: nowIso,
    status,
    articlePath,
    researchPath,
    sourceUrls: [
      ...new Set([
        ...(previous?.sourceUrls ?? []),
        ...cluster.items.map((i) => i.url),
        ...draft.sources.map((s) => s.url),
      ]),
    ],
    openQuestions: draft.openQuestions,
    sensitivity: draft.sensitivity,
    doNotRedraftBefore: new Date(Date.parse(nowIso) + options.redraftLockHours * 3_600_000).toISOString(),
    doNotUpdateBefore: new Date(Date.parse(nowIso) + options.updateThrottleHours * 3_600_000).toISOString(),
  };
  memory.stories[slug] = story;
  return story;
}

/** Zod-Schema-Verträglichkeit sicherstellen: Claim-Referenzen, Pflichtfelder. */
function sanitizeDraft(draft: DraftResult): DraftResult | null {
  const sourceIds = new Set(draft.sources.map((s) => s.id));
  const claims = draft.claims
    .map((c) => ({ ...c, sourceIds: c.sourceIds.filter((id) => sourceIds.has(id)) }))
    .filter((c) => c.sourceIds.length > 0);
  const summary = draft.summary.filter((s) => s.text.trim().length > 0);
  const body = draft.body.filter((b) => b.heading.trim() && b.markdown.trim());
  if (draft.sources.length === 0 || summary.length === 0 || body.length === 0) return null;
  return { ...draft, claims, summary, body };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
