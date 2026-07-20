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
import {
  loadArticleIndex,
  patchArticleRelated,
  patchArticleResonance,
  readExistingArticle,
  resolveSlug,
  writeArticle,
} from './article.ts';
import type { ArticleIndexEntry } from './article.ts';
import { draftOrUpdate, triageCluster } from './claude.ts';
import { buildClusters } from './cluster.ts';
import { fetchAllFeeds } from './fetch.ts';
import { enrichClusterWithFulltext } from './fulltext.ts';
import { selectCommonsImage } from './commons.ts';
import { downloadAndProcessImage, selectWhitelistImage } from './image.ts';
import { scanAndReportImageCandidates } from './image-scan.ts';
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
  RelatedCandidate,
  RunManifest,
  RunRecord,
  SourceRegistry,
  Story,
  TriageBacklogEntry,
  TriageResult,
} from './types.ts';
import { envFloat, envInt, hoursAgo, isoNow, jaccard, overlapCount, portalOf, titleTokens, utcDateStamp } from './util.ts';

const MAX_TRIAGE_PER_RUN = envInt('AI_NEWS_MAX_TRIAGE', 5);
const MAX_ARTICLES_PER_RUN = envInt('AI_NEWS_MAX_ARTICLES_PER_RUN', 1);
const MAX_WEB_SEARCH_PER_DAY = envInt('AI_NEWS_MAX_WEB_SEARCH_PER_DAY', 8);
const LOOKBACK_HOURS = envInt('AI_NEWS_LOOKBACK_HOURS', 48);
const REDRAFT_LOCK_HOURS = envInt('AI_NEWS_REDRAFT_LOCK_HOURS', 24);
const UPDATE_THROTTLE_HOURS = envInt('AI_NEWS_UPDATE_THROTTLE_HOURS', 6);
// Verwandte-Stories-Finder (E53): High-Recall über Titel-Token-Overlap, nur als
// Triage-Kandidaten — die Haiku-Triage entscheidet Update vs. Delta. Bewusst
// getrennt vom strengen matchStory (Resonanz/Dedup dürfen keine Falsch-Treffer erben).
const RELATED_MIN_OVERLAP = envInt('AI_NEWS_RELATED_MIN_OVERLAP', 2);
const RELATED_MAX_CANDIDATES = envInt('AI_NEWS_RELATED_MAX_CANDIDATES', 3);
// E55: Frische-Ausnahme des Finders — bei Artikeln jünger als dieses Fenster
// genügt Overlap 1. Lehre aus dem WM-Feier-Artikel: „Tattoo inklusive! Spanien
// feierte …“ vs. „WM-Finale: … Halbzeitpause“ teilten nur ein Token, der
// tagesaktuelle Finale-Artikel wurde der Triage nie als Kandidat vorgelegt.
const RELATED_FRESH_OVERLAP_HOURS = envInt('AI_NEWS_RELATED_FRESH_OVERLAP_HOURS', 48);
// E55: Ausgang-offen-Watch — wie lange eine Story mit pendingOutcome aktiv
// nachrecherchiert wird (ab dem Setzen des Flags). Der Update-Throttle (6 h)
// begrenzt die Versuchsfrequenz.
const PENDING_OUTCOME_TTL_HOURS = envInt('AI_NEWS_PENDING_OUTCOME_TTL_HOURS', 48);
// Recency-Gewicht der Kandidaten (E54): additiver Boost 0..1 auf den Overlap,
// damit ein frischer, echt verwandter Artikel nicht von alten Zufalls-Overlaps
// aus den Kandidaten-Slots verdrängt wird (Halbwertszeit in Tagen).
const RELATED_RECENCY_HALF_LIFE_DAYS = envInt('AI_NEWS_RELATED_RECENCY_HALF_LIFE_DAYS', 14);
// Alters-Archiv/-Gate (E54): geteiltes Frischefenster mit dem Frontend
// (articles.ts, FRESH_WINDOW_DAYS). Follow-ups auf Stories jenseits dieses
// Fensters werden Delta-Artikel statt In-Place-Updates.
const FRESH_WINDOW_DAYS = envInt('AI_NEWS_FRESH_WINDOW_DAYS', 14);
const FRESH_WINDOW_MS = FRESH_WINDOW_DAYS * 86_400_000;
// research_note trotz hohem Score/Nachrichtenwert ⇒ Draft-Versuch mit erzwungener
// Web-Suche (Primärquellen aktiv suchen statt Story liegen lassen).
const ESCALATE_SCORE = envFloat('AI_NEWS_ESCALATE_SCORE', 0.75);
// Bilder nur für hochrelevante Stories (E44): Bildsuche kostet Web-Turns und
// trägt das Rechtsrisiko — unterhalb der Schwelle bleibt der Artikel bildlos.
const IMAGE_MIN_SCORE = envFloat('AI_NEWS_IMAGE_MIN_SCORE', 0.85);
const BACKLOG_MAX_ENTRIES = envInt('AI_NEWS_BACKLOG_MAX', 24);
// Resonanz (E46): Messfenster der Publisher-Zählung; Haiku-Override-TTL ist
// bewusst identisch — Syndikations-Items fallen zeitgleich aus dem Fenster.
const RESONANCE_WINDOW_HOURS = envInt('AI_NEWS_RESONANCE_WINDOW_HOURS', 24);
const RESONANCE_TRIAGE_TTL_HOURS = RESONANCE_WINDOW_HOURS;
// Gleiches Level erneut schreiben, wenn die Messung so alt ist, dass der Decay
// eine anhaltende Welle sonst fälschlich abklingen ließe (max 2 Commits/Tag).
const RESONANCE_REFRESH_HOURS = 12;
// Ab diesem deterministischen Level bekommt der Echo-Cluster Triage-Priorität.
const RESONANCE_PRIORITY_LEVEL = 4;

/** Mapping distinkte Publisher (24 h) → Resonanz-Level (E46): 0–1→1 · 2→2 · 3→3 · 4→4 · ≥5→5. */
function resonanceLevelFor(publisherCount: number): number {
  if (publisherCount >= 5) return 5;
  return publisherCount >= 2 ? publisherCount : 1;
}

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
  // Permanenter Artikel-Index (E54): speist den Verwandte-Stories-Finder
  // (Backlinks jeden Alters) + das Alters-Gate — unabhängig von story-memory.
  const articleIndex = loadArticleIndex();
  const articleBySlug = new Map(articleIndex.map((e) => [e.slug, e]));
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

  // Phase 4.5: Resonanz-Zählung (E46) ----------------------------------------
  // Deterministisch, ohne LLM: neue Items, die auf eine Story mit publiziertem
  // Artikel matchen, füllen ein rollierendes Publisher-Fenster im Story-Memory.
  // Läuft VOR der Draft-Phase, damit Updates das gepatchte Frontmatter mitnehmen.
  for (const { cluster } of scored) {
    const story = matchStory(cluster, stories);
    if (!story?.articlePath) continue;
    const hits = (story.echoPublishers ??= {});
    for (const item of cluster.items) {
      if (item.isNew) hits[portalOf(item.sourceId)] = nowIso;
    }
  }
  // Fenster ausdünnen + deterministisches Level je Story bestimmen — auch für
  // Stories ohne Cluster-Match diesen Run (deren Welle klingt gerade ab).
  const echoWindowCutoff = hoursAgo(RESONANCE_WINDOW_HOURS, now).toISOString();
  const detResonance = new Map<string, number>(); // slug → Level aus der Zählung
  for (const story of Object.values(stories.stories)) {
    if (!story.articlePath || !story.echoPublishers) continue;
    for (const [publisher, at] of Object.entries(story.echoPublishers)) {
      if (at < echoWindowCutoff) delete story.echoPublishers[publisher];
    }
    detResonance.set(story.slug, resonanceLevelFor(Object.keys(story.echoPublishers).length));
  }

  // Haiku-Override gilt noch? Dann überschreibt die Zählung nicht (TTL, E46).
  const triageTtlCutoff = hoursAgo(RESONANCE_TRIAGE_TTL_HOURS, now).toISOString();
  const triageTtlActive = (story: Story): boolean =>
    story.resonanceSource === 'triage' && !!story.resonanceMeasuredAt && story.resonanceMeasuredAt > triageTtlCutoff;

  // Echo-Cluster ab Schwellwert priorisiert in die Triage, damit Haiku die
  // Zählung zeitnah qualifiziert (Syndikation vs. echte Welle).
  const echoPriorityClusterIds = new Set<string>();
  for (const { cluster } of scored) {
    const story = matchStory(cluster, stories);
    if (!story?.articlePath) continue;
    if ((detResonance.get(story.slug) ?? 1) >= RESONANCE_PRIORITY_LEVEL && !triageTtlActive(story)) {
      echoPriorityClusterIds.add(cluster.id);
    }
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

  // Echo-Cluster über der Prioritäts-Schwelle kommen auch dann in die Queue,
  // wenn das regelbasierte Scoring sie nicht zur Triage empfohlen hat (E46) —
  // sonst bekäme Haiku reine Echo-Wellen nie zu sehen.
  const queuedIds = new Set([...currentCandidates, ...carried].map((e) => e.cluster.id));
  const echoExtras = scored.filter(
    ({ cluster }) => echoPriorityClusterIds.has(cluster.id) && !queuedIds.has(cluster.id),
  );
  const queue = [...currentCandidates, ...carried, ...echoExtras].sort((a, b) => {
    const prio = Number(echoPriorityClusterIds.has(b.cluster.id)) - Number(echoPriorityClusterIds.has(a.cluster.id));
    return prio || b.score.score - a.score.score;
  });
  const toTriage = queue.slice(0, MAX_TRIAGE_PER_RUN);
  const overflow = queue.slice(MAX_TRIAGE_PER_RUN);
  const requeue: { cluster: Cluster; score: ClusterScore }[] = [...overflow];

  stats.carriedOver = carried.filter((c) => toTriage.includes(c)).length;
  if (carried.length > 0) {
    console.log(`Backlog: ${carried.length} Cluster übernommen, davon ${stats.carriedOver} in dieser Triage.`);
  }

  const triaged: {
    cluster: Cluster;
    score: ClusterScore;
    triage: TriageResult;
    story?: Story;
    relatedCandidates: RelatedCandidate[];
    /** E55: synthetischer Watch-Eintrag (pendingOutcome) — nie in den Backlog requeuen. */
    isWatch?: boolean;
  }[] = [];

  for (const { cluster, score } of toTriage) {
    const story = matchStory(cluster, stories);
    const relatedCandidates = findRelatedStories(cluster, articleIndex, story?.slug, now);
    const fulltexts = await enrichClusterWithFulltext(cluster);
    try {
      const triage = await triageCluster(
        cluster,
        relatedCandidates,
        story?.articlePath
          ? { slug: story.slug, publishers24h: Object.keys(story.echoPublishers ?? {}).length }
          : undefined,
      );
      triaged.push({ cluster, score, triage, story, relatedCandidates });
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

  // Phase 5.5: Resonanz auflösen + Frontmatter patchen (E46) ------------------
  // Haiku-Urteil (falls dieser Run eines lieferte) schlägt die Zählung in beide
  // Richtungen; sonst gilt die Zählung — außer ein früheres Haiku-Urteil ist
  // noch in der TTL. Geschrieben wird mit Hysterese: nur bei Level-Änderung
  // oder wenn dasselbe Level ≥ 2 länger als RESONANCE_REFRESH_HOURS steht.
  const triageResonance = new Map<string, number>();
  for (const t of triaged) {
    if (t.story?.articlePath && typeof t.triage.resonance === 'number') {
      triageResonance.set(t.story.slug, t.triage.resonance);
    }
  }

  let resonanceUpdates = 0;
  for (const [slug, detLevel] of detResonance) {
    const story = stories.stories[slug];
    if (!story) continue;

    const override = triageResonance.get(slug);
    let level: number;
    let source: 'zaehlung' | 'triage';
    if (override !== undefined) {
      level = override;
      source = 'triage';
    } else if (triageTtlActive(story)) {
      continue; // Haiku-Urteil hält noch — Zählung überschreibt nicht.
    } else {
      level = detLevel;
      source = 'zaehlung';
    }

    const storedLevel = story.resonanceLevel ?? 1;
    const stale =
      !story.resonanceMeasuredAt || story.resonanceMeasuredAt < hoursAgo(RESONANCE_REFRESH_HOURS, now).toISOString();
    if (level === storedLevel && !(level >= 2 && stale)) continue;

    story.resonanceLevel = level;
    story.resonanceSource = source;
    story.resonanceMeasuredAt = nowIso;

    // Level 1 steht nie im Frontmatter — Abklingen erledigt der Decay über
    // measuredAt, das Feld bleibt als letzter Messstand stehen.
    if (level >= 2) {
      if (patchArticleResonance(slug, { level, measuredAt: nowIso, source })) {
        resonanceUpdates += 1;
        console.log(`Resonanz: ${slug} → Level ${level} (${source})`);
      }
    }
  }
  stats.resonanceUpdates = resonanceUpdates;

  // Phase 5.7: Ausgang-offen-Watch (E55) --------------------------------------
  // Der Update-Pfad ist sonst rein reaktiv auf RSS-Zufall — der WM-Finale-Artikel
  // blieb auf Halbzeitstand stehen, weil kein späterer Cluster mehr auf ihn
  // matchte. Stories mit explizit offenem Ausgang (pendingOutcome) werden als
  // synthetische Update-Einträge ANS ENDE der Draft-Queue gehängt (echte Cluster
  // haben Vorrang) und mit Web-Suche aktiv nachrecherchiert, bis der Ausgang
  // eingearbeitet oder die Watch-TTL abgelaufen ist.
  for (const story of Object.values(stories.stories)) {
    if (!story.pendingOutcome || !story.articlePath) continue;
    if (story.pendingOutcomeUntil && story.pendingOutcomeUntil < nowIso) {
      // TTL abgelaufen — Flag räumen; die offene Frage bleibt im Artikel dokumentiert.
      delete story.pendingOutcome;
      delete story.pendingOutcomeUntil;
      continue;
    }
    if (story.doNotUpdateBefore && story.doNotUpdateBefore > nowIso) continue;
    // Kein Doppel-Anfassen, wenn ein echter Cluster diesen Run schon auf die Story zeigt.
    if (triaged.some((t) => t.story?.slug === story.slug || t.triage.relatedSlug === story.slug)) continue;
    const outcome = story.pendingOutcome;
    triaged.push({
      cluster: { id: `watch-${story.slug}`, title: outcome, tokens: titleTokens(outcome), items: [] },
      score: { score: 0, recommendedAction: 'ai_triage', reasons: ['pending-outcome watch (E55)'] },
      triage: {
        action: 'update_story',
        reason:
          `Ausgang-offen-Watch (E55): Der publizierte Artikel beschreibt ein laufendes Ereignis; erwartet wird: ${outcome}. ` +
          'Kein neuer RSS-Cluster — recherchiere das Folgeereignis per Web-Suche und arbeite es ein. ' +
          'Ist es noch nicht eingetreten, gib den Artikel inhaltlich unverändert zurück (updateNote null) und setze pendingOutcome erneut.',
        sensitivity: story.sensitivity ?? 'low',
        newsworthiness: 3,
        resonance: null,
        relatedSlug: story.slug,
        possibleClaims: [],
        missingSources: [outcome],
      },
      story,
      relatedCandidates: [],
      isWatch: true,
    });
    console.log(`Watch (E55): ${story.slug} — offener Ausgang „${outcome}“ wird nachrecherchiert.`);
  }

  // Phase 6: Drafts/Updates (Sonnet, max MAX_ARTICLES_PER_RUN) ----------------
  const searchBudget = Math.max(0, MAX_WEB_SEARCH_PER_DAY - webSearchCallsToday(history, dateStamp));
  const written: ManifestArticle[] = [];

  for (const entry of triaged) {
    const { cluster, triage } = entry;
    let story = entry.story; // strenger Match (Resonanz/Dedup)

    // E53/E54: Haiku kann eine verwandte publizierte Story benannt haben (relatedSlug) —
    // Update-Ziel oder Bezugsartikel eines Delta-Artikels. Der Bezugsartikel wird über
    // den permanenten Artikel-Index aufgelöst (Delta-Backlinks jeden Alters), NICHT über
    // die kurzlebige story-memory. relatedSlug ist bereits gegen die Kandidaten validiert.
    let relatedEntry = triage.relatedSlug ? articleBySlug.get(triage.relatedSlug) : undefined;
    let relatedHasArticle = !!relatedEntry;
    // Update-Ziel muss eine noch gemerkte Story sein (Throttle/Resonanz/Upsert): Haiku-Slug
    // in memory, sonst der strenge Match. Nur Stories mit Artikel sind Update-fähig (E31).
    const relatedStoryMem = triage.relatedSlug ? stories.stories[triage.relatedSlug] : undefined;
    let updateTarget: Story | undefined =
      relatedHasArticle && relatedStoryMem?.articlePath ? relatedStoryMem : story?.articlePath ? story : undefined;

    // Alters-Gate (E54): Ein Update-Ziel jenseits des Frischefensters wird NICHT mehr
    // in-place aktualisiert — die neue Entwicklung wird ein eigenständiger Delta-Artikel
    // mit Rückverweis. Die Altstory behält ihr Datum → sauberes Archiv, der neue Artikel
    // ist frisch + indexiert. Ein Fenster teilt sich mit dem Frontend-Archiv (articles.ts).
    if (updateTarget && articleOlderThanFreshWindow(updateTarget.slug, articleBySlug, now)) {
      if (!relatedEntry) relatedEntry = articleBySlug.get(updateTarget.slug);
      relatedHasArticle = !!relatedEntry;
      console.log(`Alters-Gate (E54): ${updateTarget.slug} ≥ ${FRESH_WINDOW_DAYS} d alt → Delta statt Update.`);
      updateTarget = undefined;
    }

    let action = triage.action;

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
          `Eskalation: research_note → ${updateTarget ? 'Update' : 'Draft'} mit Web-Suche für ${cluster.title} (Score ${entry.score.score}, Nachrichtenwert ${triage.newsworthiness}).`,
        );
        action = updateTarget ? 'update_story' : 'draft_article';
      } else {
        writeResearchNote(dateStamp, cluster, triage, nowIso);
        stats.notes += 1;
        noteStory(stories, cluster, triage, nowIso);
        continue;
      }
    }

    // Delta-Artikel (E53): Haiku hat bewusst draft_article MIT verwandter Story
    // gewählt → eigenständiger neuer Artikel, der auf den Bestand verweist.
    let isDelta = action === 'draft_article' && relatedHasArticle;
    // Sicherheitsnetz (alte E31-Regel): strenger Match mit Artikel + KEINE bewusste
    // Delta-Wahl + draft_article → kein Zufalls-Duplikat, stattdessen Update.
    if (action === 'draft_article' && !isDelta && story?.articlePath) action = 'update_story';
    // update_story ohne verfügbares Ziel → regulärer neuer Artikel.
    if (action === 'update_story' && !updateTarget) action = 'draft_article';

    if (action !== 'draft_article' && action !== 'update_story') continue;
    if (written.length >= MAX_ARTICLES_PER_RUN) {
      // Artikel-Cap erreicht: Cluster zurück in den Backlog, nächster Run
      // triagt ihn erneut — nichts fällt wegen Cap dauerhaft raus. Watch-Einträge
      // (E55) nicht: sie werden jeden Run neu aus dem Story-Memory erzeugt.
      if (!entry.isWatch) requeue.push({ cluster, score: entry.score });
      continue;
    }

    const isUpdate = action === 'update_story';
    isDelta = !isUpdate && relatedHasArticle && action === 'draft_article';
    const updateStory = isUpdate ? updateTarget! : undefined;

    if (isUpdate && updateStory!.doNotUpdateBefore && updateStory!.doNotUpdateBefore > nowIso) {
      console.log(`Update-Throttle aktiv für ${updateStory!.slug} — übersprungen.`);
      continue;
    }
    // Redraft-Lock nur für echte Erst-Drafts über den strengen Match — ein Delta
    // hat einen eigenen neuen Slug und ist bewusst gewollt, kein Re-Draft.
    if (!isUpdate && !isDelta) {
      const lockedStory = matchStory(cluster, stories);
      if (lockedStory?.doNotRedraftBefore && lockedStory.doNotRedraftBefore > nowIso) continue;
    }

    const existingArticle = isUpdate ? readExistingArticle(updateStory!.slug) : null;
    if (isUpdate && !existingArticle) {
      // Artikeldatei liegt nicht auf main (z. B. Altbestand aus früherem
      // Review-PR-Flow oder manuell entfernt) — kein Doppel-Draft.
      console.log(`Update für ${updateStory!.slug} übersprungen — Artikeldatei nicht auf main.`);
      continue;
    }

    // E55: Web-Suche für jeden Draft/Update/Delta — einziges Gate ist das
    // Tagesbudget. Die frühere Portal-Zähl-Heuristik (Suche erst ab 3 Portalen)
    // war epistemisch verkehrt: ausgerechnet dünne Quellenlagen, wo Recherche am
    // nötigsten ist, bekamen keine.
    const useWebSearch = searchBudget - stats.webSearchCalls > 0;
    // Ein Watch-Update ohne Web-Suche ist zwecklos (kein neuer RSS-Input) —
    // Budget erschöpft ⇒ nächster Run versucht es wieder.
    if (entry.isWatch && !useWebSearch) continue;
    const allowImage = entry.score.score >= IMAGE_MIN_SCORE;

    try {
      const { draft, webSearchUsed } = await draftOrUpdate({
        cluster,
        triage,
        existingArticle: existingArticle
          ? { slug: updateStory!.slug, frontmatterYaml: existingArticle.frontmatterYaml, body: existingArticle.body }
          : undefined,
        // E53/E54: Delta-Draft bekommt den Bezugsartikel als „bereits berichtet"-Kontext,
        // aufgelöst aus dem permanenten Artikel-Index (jeden Alters).
        relatedArticle:
          isDelta && relatedEntry
            ? {
                slug: relatedEntry.slug,
                title: relatedEntry.title,
                summary: relatedEntry.summary,
                openQuestions: relatedEntry.openQuestions,
              }
            : undefined,
        // E55: verwandte publizierte Artikel als Kontextwissen in JEDEN Draft —
        // ohne den Artikel, der ohnehin schon als Update-Ziel/Delta-Bezug mitgeht.
        siteContext: entry.relatedCandidates
          .map((c) => articleBySlug.get(c.slug))
          .filter((e): e is ArticleIndexEntry => !!e)
          .filter((e) => e.slug !== updateStory?.slug && e.slug !== (isDelta ? relatedEntry?.slug : undefined))
          .map((e) => ({ slug: e.slug, title: e.title, summary: e.summary, openQuestions: e.openQuestions })),
        useWebSearch,
      });
      stats.webSearchCalls += webSearchUsed;

      const sanitized = sanitizeDraft(draft);
      if (!sanitized) {
        throw new Error('Draft unbrauchbar: keine gültigen Quellen oder leerer Body.');
      }

      // E55: Watch-Nachrecherche ohne neuen Stand — nichts schreiben; der
      // Update-Throttle schiebt den nächsten Versuch hinaus, die Watch bleibt.
      if (entry.isWatch && !sanitized.updateNote) {
        updateStory!.doNotUpdateBefore = new Date(
          Date.parse(nowIso) + UPDATE_THROTTLE_HOURS * 3_600_000,
        ).toISOString();
        console.log(`Watch (E55): ${updateStory!.slug} — Folgeereignis noch nicht eingetreten, kein Update.`);
        continue;
      }

      const slug = isUpdate ? updateStory!.slug : resolveSlug(sanitized.slugSuggestion, sanitized.title);

      const existingFm = existingArticle?.frontmatter as
        | { publishedAt?: string | Date; newsworthiness?: number; corrections?: { date: string | Date; type: 'correction' | 'update'; text: string }[]; image?: Record<string, unknown>; resonance?: Record<string, unknown>; relatedSlugs?: string[] }
        | undefined;

      // Bild: Updates behalten das bestehende Bild; sonst zuerst deterministisch
      // aus der kuratierten Whitelist (E44), bei Miss als Fallback ein Commons-
      // Symbolbild (E49). Beides nur für hochrelevante Stories. Jeder Fehler ⇒
      // Artikel ohne Bild.
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

      // Commons-Fallback (E49): nur wenn kein Whitelist-Bild gefunden wurde.
      // Sensitivity-/Framing-Gate: bei heiklen Stories (Verbrechen/Opfer/Kinder,
      // § 78 UrhG) KEIN automatisches Symbolbild — Restrisiko dort zu hoch.
      const commonsOk =
        process.env.AI_NEWS_COMMONS !== '0' &&
        sanitized.sensitivity !== 'high' &&
        sanitized.framingRisk !== 'high';
      if (!imageFrontmatter && allowImage && commonsOk) {
        const commons = await selectCommonsImage(sanitized);
        if (commons) {
          try {
            const file = await downloadAndProcessImage(slug, commons.image.downloadUrl);
            imageFrontmatter = {
              file,
              alt: commons.image.alt,
              caption: commons.image.caption,
              kind: 'symbol',
              credit: { ...commons.image.credit, retrievedAt: nowIso },
            };
            imagePath = `src/assets/articles/${slug}/hero.webp`;
            console.log(`Commons-Symbolbild (${commons.match}) übernommen für ${slug}: ${commons.fileTitle}`);
          } catch (error) {
            console.warn(`Commons-Bild verworfen für ${slug}: ${(error as Error).message}`);
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
        // Resonanz (E46) übersteht das Update unverändert — Phase 5.5 hat sie
        // vor der Draft-Phase gesetzt, readExistingArticle liest den Stand.
        resonance: existingFm?.resonance,
        // E53: Delta-Artikel verweist auf den Bezugsartikel; Updates behalten
        // bestehende relatedSlugs (writeArticle baut das Frontmatter sonst neu).
        relatedSlugs: isDelta && relatedEntry ? [relatedEntry.slug] : existingFm?.relatedSlugs,
      });

      // E53: Delta-Artikel bidirektional verlinken — Bezugsartikel bekommt den
      // Rückverweis (analog patchArticleResonance).
      if (isDelta && relatedEntry && patchArticleRelated(relatedEntry.slug, slug)) {
        console.log(`Delta-Artikel ${slug} ↔ ${relatedEntry.slug} verlinkt.`);
      }

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
        // E53: Delta ist eine eigene, neue Story — nie eine bestehende (Bezugs-/
        // Strict-Match-)Story per Rename-Logik aus dem Memory löschen.
        treatAsNew: isDelta,
      });

      if (isUpdate) stats.updates += 1;
      else stats.drafts += 1;
      written.push({ slug, articlePath, researchPath: researchRelPath, ...(imagePath ? { imagePath } : {}), isUpdate });
      console.log(`${isUpdate ? 'Update' : isDelta ? 'Delta-Artikel' : 'Draft'} geschrieben: ${articlePath} (auto-publish)`);

      // Bild-Kandidaten-Scan (E48): neue Artikel ohne Whitelist-Bild — reine
      // Recherche-Vorarbeit für die Whitelist-Pflege, nie Auto-Attach. Bewusst
      // ohne Score-Gate (der Scan attached nichts, das Gate würde das Register
      // aushungern). Die Funktion wirft nie — ein Scan-Fehler darf nicht als
      // Draft-Fehler in die Eskalations-Fallbacks laufen.
      if (!isUpdate && !imageFrontmatter && process.env.AI_NEWS_IMAGE_SCAN !== '0') {
        stats.imageCandidates =
          (stats.imageCandidates ?? 0) +
          (await scanAndReportImageCandidates({ slug, title: sanitized.title, sources: sanitized.sources, nowIso }));
      }
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
  } else if (resonanceUpdates > 0) {
    // Nur resonance-Frontmatter geändert — braucht trotzdem Commit + Deploy (E46).
    manifest = { ranAt: nowIso, action: 'resonance_update', articles: [], stats };
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

/**
 * High-Recall-Kandidaten für die Update-vs-Delta-Entscheidung (E53, revidiert E54):
 * publizierte Artikel aus dem permanenten Platten-Index (jeden Alters — story-memory
 * vergisst nach 30 d), deren Titel genug markante Tokens mit dem Cluster teilen (fuzzy
 * overlap, komposita-tolerant). Recency-gewichtet: ein additiver Boost 0..1 verhindert,
 * dass ein frischer, echt verwandter Artikel von alten Zufalls-Overlaps aus den Slots
 * verdrängt wird — hebt aber keinen schwachen über einen deutlich stärkeren alten Match.
 * Der strenge matchStory-Treffer (strictSlug) wird IMMER aufgenommen. Präzision liefert
 * danach die Haiku-Triage.
 */
function findRelatedStories(
  cluster: Cluster,
  articleIndex: ArticleIndexEntry[],
  strictSlug: string | undefined,
  now: Date,
): RelatedCandidate[] {
  const clusterTokens = titleTokens(cluster.title);
  const nowMs = now.getTime();
  const scored: { entry: ArticleIndexEntry; rank: number }[] = [];
  for (const entry of articleIndex) {
    if (entry.status !== 'published') continue;
    // E55: Summary-Bullets matchen mit — Schlagzeilen desselben Ereignisses teilen
    // oft kaum Titel-Tokens (Feier-Nachberichte vs. Spielbericht), die Kurzfazits schon.
    const summaryText = entry.summary.map((s) => s.text).join(' ');
    const overlap = overlapCount(clusterTokens, titleTokens(`${entry.title} ${summaryText}`));
    const isStrict = strictSlug === entry.slug;
    const ref = entry.updatedAt ?? entry.publishedAt;
    const ageDays = ref ? Math.max(0, (nowMs - Date.parse(ref)) / 86_400_000) : 3650;
    // E55: bei ganz frischen Artikeln genügt Overlap 1 — Präzision liefert die Triage.
    const minOverlap = ageDays * 24 < RELATED_FRESH_OVERLAP_HOURS ? 1 : RELATED_MIN_OVERLAP;
    if (overlap < minOverlap && !isStrict) continue;
    const recencyBoost = Math.pow(0.5, ageDays / RELATED_RECENCY_HALF_LIFE_DAYS); // 0..1
    const rank = isStrict ? Number.MAX_SAFE_INTEGER : overlap + recencyBoost;
    scored.push({ entry, rank });
  }
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, RELATED_MAX_CANDIDATES).map(({ entry }) => ({
    slug: entry.slug,
    canonicalTitle: entry.title,
    status: 'published',
    hasPublishedArticle: true,
    openQuestions: entry.openQuestions,
  }));
}

/** Alters-Gate (E54): Artikel jenseits des Frischefensters (Basis lastUpdated) — dann Delta statt Update. */
function articleOlderThanFreshWindow(
  slug: string,
  articleBySlug: Map<string, ArticleIndexEntry>,
  now: Date,
): boolean {
  const entry = articleBySlug.get(slug);
  const ref = entry?.updatedAt ?? entry?.publishedAt;
  if (!ref) return false;
  return now.getTime() - Date.parse(ref) >= FRESH_WINDOW_MS;
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
    /** E53: Delta-Artikel — eigene neue Story, kein Rename einer bestehenden. */
    treatAsNew?: boolean;
  },
): Story {
  const { slug, cluster, draft, articlePath, researchPath, nowIso } = options;
  // Delta (treatAsNew): nur exakter Slug-Treffer gilt als Vorgänger — nie die
  // per matchStory gefundene Bezugs-/Strict-Story überschreiben oder löschen.
  const previous = options.treatAsNew ? memory.stories[slug] : (memory.stories[slug] ?? matchStory(cluster, memory));
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
    // Ausgang-offen-Watch (E55): Flag aus dem Draft übernehmen; pendingOutcome
    // null/fehlend ⇒ Watch beendet (Felder werden hier bewusst nicht kopiert).
    // Die TTL läuft ab dem ERSTEN Setzen — ein Update, das den Ausgang weiter
    // offen meldet, verlängert sie nicht endlos.
    ...(typeof draft.pendingOutcome === 'string' && draft.pendingOutcome.trim()
      ? {
          pendingOutcome: draft.pendingOutcome.trim(),
          pendingOutcomeUntil:
            (previous?.pendingOutcome ? previous.pendingOutcomeUntil : undefined) ??
            new Date(Date.parse(nowIso) + PENDING_OUTCOME_TTL_HOURS * 3_600_000).toISOString(),
        }
      : {}),
    // Resonanz-Zustand (E46) übersteht Drafts/Updates — sonst ginge das
    // Messfenster bei jedem Story-Update verloren.
    ...(previous?.echoPublishers ? { echoPublishers: previous.echoPublishers } : {}),
    ...(previous?.resonanceLevel !== undefined ? { resonanceLevel: previous.resonanceLevel } : {}),
    ...(previous?.resonanceSource ? { resonanceSource: previous.resonanceSource } : {}),
    ...(previous?.resonanceMeasuredAt ? { resonanceMeasuredAt: previous.resonanceMeasuredAt } : {}),
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
