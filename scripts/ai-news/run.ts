/**
 * Orchestrator der AI-News-Pipeline (PLAN.md E25–E36).
 *
 * Ablauf pro Run: RSS-Fetch → Dedupe (seen-items) → Clustering → Scoring →
 * Haiku-Triage (max 5) → max 1 Sonnet-Draft/-Update → MDX + Research-JSON →
 * Memory-Update → Manifest für den Workflow (Commit passiert dort).
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
import { enrichClusterWithFulltext } from './fulltext.ts';
import { downloadAndProcessImage, selectWhitelistImage } from './image.ts';
import {
  DATA_DIR,
  appendErrorNote,
  appendRunHistory,
  loadRunHistory,
  loadSeenItems,
  loadSourceHealth,
  loadStoryMemory,
  loadTriageBacklog,
  saveSeenItems,
  saveSourceHealth,
  saveStoryMemory,
  saveTriageBacklog,
  webSearchCallsToday,
  writeJson,
  writeWorkFile,
} from './memory.ts';
import { scoreCluster } from './score.ts';
import type {
  Cluster,
  ClusterItem,
  ClusterScore,
  DraftResult,
  ManifestArticle,
  RunManifest,
  RunRecord,
  SourceRegistry,
  Story,
  TriageBacklogEntry,
  TriageResult,
} from './types.ts';
import { envFloat, envInt, isoNow, jaccard, portalOf, titleTokens, utcDateStamp } from './util.ts';

const MAX_TRIAGE_PER_RUN = envInt('AI_NEWS_MAX_TRIAGE', 5);
const MAX_ARTICLES_PER_RUN = envInt('AI_NEWS_MAX_ARTICLES_PER_RUN', 1);
const MAX_WEB_SEARCH_PER_DAY = envInt('AI_NEWS_MAX_WEB_SEARCH_PER_DAY', 8);
const LOOKBACK_HOURS = envInt('AI_NEWS_LOOKBACK_HOURS', 48);
const REDRAFT_LOCK_HOURS = envInt('AI_NEWS_REDRAFT_LOCK_HOURS', 24);
const UPDATE_THROTTLE_HOURS = envInt('AI_NEWS_UPDATE_THROTTLE_HOURS', 6);
const WEB_SEARCH_MIN_PORTALS = envInt('AI_NEWS_WEB_SEARCH_MIN_PORTALS', 3);
// research_note trotz hohem Score/Nachrichtenwert ⇒ Draft-Versuch mit erzwungener
// Web-Suche (Primärquellen aktiv suchen statt Story liegen lassen).
const ESCALATE_SCORE = envFloat('AI_NEWS_ESCALATE_SCORE', 0.75);
// Bilder nur für hochrelevante Stories (E44): Bildsuche kostet Web-Turns und
// trägt das Rechtsrisiko — unterhalb der Schwelle bleibt der Artikel bildlos.
const IMAGE_MIN_SCORE = envFloat('AI_NEWS_IMAGE_MIN_SCORE', 0.85);
const BACKLOG_MAX_ENTRIES = envInt('AI_NEWS_BACKLOG_MAX', 24);

const dryRun = process.argv.includes('--dry-run') || process.env.AI_NEWS_DRY_RUN === '1';

async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const dateStamp = utcDateStamp(now);

  if (!dryRun && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.error('CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) fehlt — Abbruch (für Tests: --dry-run).');
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

  let manifest: RunManifest = { ranAt: nowIso, action: 'none', articles: [], stats };

  if (dryRun) {
    console.log('Dry-Run — keine Claude-Calls, keine Writes.');
    writeWorkFile('run-output.json', manifest);
    return;
  }

  // Phase 5: Triage (Haiku) ---------------------------------------------------
  // Queue = aktuelle Kandidaten + Backlog voriger Runs (Cap-Überlauf/Triage-Fehler).
  // Kein Cluster über der Schwelle geht verloren: was nicht triaged wird, landet
  // wieder im Backlog, bis es triaged ist oder aus dem Lookback-Fenster altert.
  const backlog = loadTriageBacklog();
  // queuedAt der Alt-Einträge merken — Retention läuft ab Erst-Einreihung, nicht ab Requeue.
  const previousQueuedAt = new Map(backlog.entries.map((e) => [e.clusterId, e.queuedAt]));
  const currentCandidates = scored.filter(({ score }) => score.recommendedAction === 'ai_triage');
  const carried = backlog.entries
    .filter((entry) => !coveredByCurrentCandidate(entry, currentCandidates))
    .map((entry) => ({
      cluster: {
        id: entry.clusterId,
        title: entry.title,
        tokens: titleTokens(entry.title),
        items: entry.items,
      } satisfies Cluster,
      score: {
        score: entry.score,
        recommendedAction: 'ai_triage',
        reasons: ['carried over from triage backlog'],
      } satisfies ClusterScore,
    }));

  const queue = [...currentCandidates, ...carried].sort((a, b) => b.score.score - a.score.score);
  const toTriage = queue.slice(0, MAX_TRIAGE_PER_RUN);
  const overflow = queue.slice(MAX_TRIAGE_PER_RUN);
  const requeue: { cluster: Cluster; score: ClusterScore }[] = [...overflow];

  stats.carriedOver = carried.filter((c) => toTriage.includes(c)).length;
  if (carried.length > 0) {
    console.log(`Backlog: ${carried.length} Cluster übernommen, davon ${stats.carriedOver} in dieser Triage.`);
  }

  const triaged: { cluster: Cluster; score: ClusterScore; triage: TriageResult; story?: Story }[] = [];

  for (const { cluster, score } of toTriage) {
    const story = matchStory(cluster, stories);
    const fulltexts = await enrichClusterWithFulltext(cluster);
    try {
      const triage = await triageCluster(cluster, story);
      triaged.push({ cluster, score, triage, story });
      stats.aiTriaged += 1;
      console.log(`Triage [${triage.action}/${triage.sensitivity}] ${cluster.title} (${fulltexts} Volltexte) — ${triage.reason}`);
    } catch (error) {
      stats.errors += 1;
      // Fehler ⇒ zurück in den Backlog, nächster Run versucht es erneut.
      requeue.push({ cluster, score });
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

  // Phase 6: Drafts/Updates (Sonnet, max MAX_ARTICLES_PER_RUN) ----------------
  const searchBudget = Math.max(0, MAX_WEB_SEARCH_PER_DAY - webSearchCallsToday(history, dateStamp));
  const written: ManifestArticle[] = [];

  for (const entry of triaged) {
    const { cluster, triage } = entry;
    let story = entry.story;

    // Nur Stories mit real existierendem Artikel sind Updates (E31). noted/
    // monitor-Stories ohne Artikel werden regulär gedraftet — sonst entstünden
    // Artikel-Slugs aus Cluster-IDs.
    const hasArticle = !!story?.articlePath;
    let action = triage.action;
    if (story && hasArticle && action === 'draft_article') action = 'update_story';
    if (action === 'update_story' && !hasArticle) action = 'draft_article';

    // research_note trotz hohem Score/Nachrichtenwert ⇒ Draft-Versuch mit
    // erzwungener Web-Suche: Primärquellen aktiv suchen statt Story liegen lassen.
    let escalated = false;
    if (action === 'research_note') {
      escalated =
        written.length < MAX_ARTICLES_PER_RUN &&
        searchBudget - stats.webSearchCalls > 0 &&
        (entry.score.score >= ESCALATE_SCORE || triage.newsworthiness >= 4);
      if (escalated) {
        console.log(
          `Eskalation: research_note → ${hasArticle ? 'Update' : 'Draft'} mit Web-Suche für ${cluster.title} (Score ${entry.score.score}, Nachrichtenwert ${triage.newsworthiness}).`,
        );
        action = hasArticle ? 'update_story' : 'draft_article';
      } else {
        writeResearchNote(dateStamp, cluster, triage, nowIso);
        stats.notes += 1;
        noteStory(stories, cluster, triage, nowIso);
        continue;
      }
    }

    if (action !== 'draft_article' && action !== 'update_story') continue;
    if (written.length >= MAX_ARTICLES_PER_RUN) {
      // Artikel-Cap erreicht: Cluster zurück in den Backlog, nächster Run
      // triagt ihn erneut — nichts fällt wegen Cap dauerhaft raus.
      requeue.push({ cluster, score: entry.score });
      continue;
    }

    const isUpdate = action === 'update_story' && !!story;
    if (isUpdate && story!.doNotUpdateBefore && story!.doNotUpdateBefore > nowIso) {
      console.log(`Update-Throttle aktiv für ${story!.slug} — übersprungen.`);
      continue;
    }
    if (!isUpdate) {
      const lockedStory = matchStory(cluster, stories);
      if (lockedStory?.doNotRedraftBefore && lockedStory.doNotRedraftBefore > nowIso) continue;
    }

    const existingArticle = isUpdate ? readExistingArticle(story!.slug) : null;
    if (isUpdate && !existingArticle) {
      // Artikeldatei liegt nicht auf main (z. B. Altbestand aus früherem
      // Review-PR-Flow oder manuell entfernt) — kein Doppel-Draft.
      console.log(`Update für ${story!.slug} übersprungen — Artikeldatei nicht auf main.`);
      continue;
    }

    const portals = new Set(cluster.items.map((i) => portalOf(i.sourceId)));
    const useWebSearch =
      searchBudget - stats.webSearchCalls > 0 && (escalated || isUpdate || portals.size >= WEB_SEARCH_MIN_PORTALS);
    const allowImage = entry.score.score >= IMAGE_MIN_SCORE;

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

      const slug = isUpdate ? story!.slug : resolveSlug(sanitized.slugSuggestion, sanitized.title);

      const existingFm = existingArticle?.frontmatter as
        | { publishedAt?: string | Date; newsworthiness?: number; corrections?: { date: string | Date; type: 'correction' | 'update'; text: string }[]; image?: Record<string, unknown> }
        | undefined;

      // Bild (E44): Updates behalten das bestehende Bild; sonst deterministisch
      // aus der kuratierten Whitelist wählen (keine LLM-Bildsuche) und nur für
      // hochrelevante Stories. Jeder Fehler ⇒ Artikel ohne Bild.
      let imageFrontmatter = existingFm?.image;
      let imagePath: string | undefined;
      if (!imageFrontmatter && allowImage) {
        const selection = selectWhitelistImage(sanitized);
        if (selection) {
          try {
            const file = await downloadAndProcessImage(slug, selection.image.downloadUrl);
            imageFrontmatter = {
              file,
              alt: selection.image.alt,
              caption: selection.image.caption,
              kind: selection.image.kind,
              credit: { ...selection.image.credit, retrievedAt: nowIso },
            };
            imagePath = `src/assets/articles/${slug}/hero.webp`;
            console.log(`Bild übernommen für ${slug}: Whitelist-Eintrag ${selection.entryId}`);
          } catch (error) {
            console.warn(`Bild verworfen für ${slug}: ${(error as Error).message}`);
          }
        }
      }

      const articlePath = writeArticle({
        slug,
        draft: sanitized,
        // Update-Triage sieht nur inkrementelle Items — große Story nie herabstufen (E38);
        // Alterung übernimmt der Frische-Decay im Ranking.
        newsworthiness: isUpdate
          ? Math.max(Number(existingFm?.newsworthiness ?? 3), triage.newsworthiness)
          : triage.newsworthiness,
        publishedAt: existingFm?.publishedAt ? new Date(existingFm.publishedAt).toISOString() : undefined,
        existingCorrections: (existingFm?.corrections ?? []).map((c) => ({
          date: new Date(c.date).toISOString(),
          type: c.type,
          text: c.text,
        })),
        updateNote: isUpdate ? (sanitized.updateNote ?? 'Artikel um neue Quellen ergänzt.') : undefined,
        nowIso,
        image: imageFrontmatter,
      });

      const researchPath = join(DATA_DIR, 'research', dateStamp, `${slug}${isUpdate ? `-update-${now.getUTCHours()}00` : ''}.json`);
      const researchRelPath = relative(process.cwd(), researchPath).replace(/\\/g, '/');
      writeJson(researchPath, {
        // Volltext-Auszüge nie persistieren (Urheberrecht) — nur Discovery-Metadaten.
        cluster: { id: cluster.id, title: cluster.title, items: itemsForPersistence(cluster.items) },
        clusterScore: entry.score.score,
        triage,
        draft: sanitized,
        webSearchUsed,
        createdAt: nowIso,
      });

      story = upsertStory(stories, {
        slug,
        cluster,
        draft: sanitized,
        articlePath,
        researchPath: researchRelPath,
        nowIso,
        redraftLockHours: REDRAFT_LOCK_HOURS,
        updateThrottleHours: UPDATE_THROTTLE_HOURS,
      });

      if (isUpdate) stats.updates += 1;
      else stats.drafts += 1;
      written.push({ slug, articlePath, researchPath: researchRelPath, ...(imagePath ? { imagePath } : {}), isUpdate });
      console.log(`${isUpdate ? 'Update' : 'Draft'} geschrieben: ${articlePath} (auto-publish)`);
    } catch (error) {
      stats.errors += 1;
      if (escalated) {
        // Eskalation gescheitert ⇒ wenigstens die Research-Note festhalten.
        writeResearchNote(dateStamp, cluster, triage, nowIso);
        stats.notes += 1;
        noteStory(stories, cluster, triage, nowIso);
      }
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

  if (written.length > 0) {
    const primary = written[0];
    manifest = {
      ranAt: nowIso,
      action: written.some((a) => !a.isUpdate) ? 'published_new' : 'published_update',
      articles: written,
      slug: primary.slug,
      articlePath: primary.articlePath,
      stats,
    };
  }

  // Phase 7: Memory + Manifest -----------------------------------------------
  backlog.entries = requeue
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, BACKLOG_MAX_ENTRIES)
    .map(({ cluster, score }) => ({
      clusterId: cluster.id,
      title: cluster.title,
      score: score.score,
      items: itemsForPersistence(cluster.items),
      queuedAt: previousQueuedAt.get(cluster.id) ?? nowIso,
    }));
  stats.backlogged = backlog.entries.length;
  if (backlog.entries.length > 0) {
    console.log(`Backlog gespeichert: ${backlog.entries.length} Cluster für nächsten Run.`);
  }
  saveTriageBacklog(backlog, LOOKBACK_HOURS);
  saveSeenItems(seen);
  saveStoryMemory(stories);
  saveSourceHealth(health);
  appendRunHistory(stats);
  manifest.stats = stats;
  writeWorkFile('run-output.json', manifest);
  console.log(`Run fertig: ${JSON.stringify(stats)}`);
}

// ---------------------------------------------------------------------------

/** Backlog-Eintrag ist obsolet, wenn ein aktueller Kandidat dieselbe Story abdeckt (URL oder Titel). */
function coveredByCurrentCandidate(
  entry: TriageBacklogEntry,
  candidates: { cluster: Cluster }[],
): boolean {
  const urls = new Set(entry.items.map((i) => i.url));
  const tokens = titleTokens(entry.title);
  return candidates.some(
    ({ cluster }) => cluster.items.some((i) => urls.has(i.url)) || jaccard(tokens, cluster.tokens) >= 0.5,
  );
}

/** Volltext-Auszüge nie nach Git persistieren (Urheberrecht) — Feld strippen. */
function itemsForPersistence(items: ClusterItem[]): ClusterItem[] {
  return items.map(({ fulltext: _fulltext, ...rest }) => rest);
}

function writeResearchNote(dateStamp: string, cluster: Cluster, triage: TriageResult, nowIso: string): void {
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
}

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
    articlePath: string;
    researchPath: string;
    nowIso: string;
    redraftLockHours: number;
    updateThrottleHours: number;
  },
): Story {
  const { slug, cluster, draft, articlePath, researchPath, nowIso } = options;
  const previous = memory.stories[slug] ?? matchStory(cluster, memory);
  if (previous && previous.slug !== slug) delete memory.stories[previous.slug];

  const story: Story = {
    canonicalTitle: draft.title,
    slug,
    firstSeenAt: previous?.firstSeenAt ?? nowIso,
    lastUpdatedAt: nowIso,
    status: 'published',
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
  // Kompakt-Konvention hart absichern (validate.ts prüft dieselben Regeln):
  // keine Überschriften-Zeichen, maximal 3 Absätze.
  const bodyKompakt = (draft.bodyKompakt ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .slice(0, 3)
    .join('\n\n');
  if (draft.sources.length === 0 || summary.length === 0 || body.length === 0 || !bodyKompakt) return null;
  return { ...draft, claims, summary, body, bodyKompakt };
}

main()
  .then(() => {
    // Explizit beenden: abgebrochene Feed-Sockets dürfen den Prozess nicht offenhalten.
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
