/**
 * Phase 3: Clustering per Titel-Token-Overlap (Jaccard), 48h-Fenster.
 * Kein Embedding — pragmatisch für v1 (PLAN.md E25ff).
 *
 * BEKANNTE GRENZE / Follow-up: Rein titelbasiertes Clustering merged dasselbe
 * real-weltliche Ereignis nicht, wenn Outlets es unterschiedlich betiteln (z. B.
 * „X schließen Y aus“ vs. „Wie Ys Abgang auf die Koalition wirkt“). Dann zerfällt
 * ein breit berichtetes Ereignis in mehrere Cluster, von denen einer nur ein
 * Portal enthält — was in der Draft-Phase zu einer irreführend pessimistischen
 * Quellenlage-Bewertung führt. Abgefedert wird das derzeit in run.ts (Web-Suche
 * für hochwertige Low-Portal-Drafts erzwingen + Publish-Guard). Der tiefere Fix
 * wäre entity-/embedding-basiertes Merging; bewusst zurückgestellt (Über-Merge-Risiko).
 */
import type { Cluster, ClusterItem, FeedItem, SeenItems } from './types.ts';
import { envFloat, hoursAgo, jaccard, overlapCount, sha256, titleTokens, utcDateStamp } from './util.ts';

const JACCARD_THRESHOLD = envFloat('AI_NEWS_CLUSTER_JACCARD', 0.3);
const MIN_TOKEN_OVERLAP = 3;

export function buildClusters(newItems: FeedItem[], seen: SeenItems, lookbackHours: number): Cluster[] {
  const cutoff = hoursAgo(lookbackHours).toISOString();

  const candidates: ClusterItem[] = newItems.map((item) => ({
    itemId: item.id,
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    title: item.title,
    url: item.url,
    summary: item.summary,
    publishedAt: item.publishedAt,
    isNew: true,
  }));

  const newIds = new Set(newItems.map((i) => i.id));
  for (const [id, item] of Object.entries(seen.items)) {
    if (newIds.has(id) || item.lastSeenAt < cutoff) continue;
    candidates.push({
      itemId: id,
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      title: item.title,
      url: item.url,
      isNew: false,
    });
  }

  const clusters: Cluster[] = [];
  const byUrl = new Map<string, Cluster>();

  for (const item of candidates) {
    const tokens = titleTokens(item.title);

    let target = byUrl.get(item.url);
    if (!target) {
      let best: Cluster | undefined;
      let bestScore = 0;
      for (const cluster of clusters) {
        const score = jaccard(tokens, cluster.tokens);
        if (score > bestScore && (score >= JACCARD_THRESHOLD || overlapCount(tokens, cluster.tokens) >= MIN_TOKEN_OVERLAP)) {
          best = cluster;
          bestScore = score;
        }
      }
      target = best;
    }

    if (target) {
      target.items.push(item);
      for (const token of tokens) target.tokens.add(token);
    } else {
      clusters.push({
        id: `cluster-${utcDateStamp().replace(/-/g, '')}-${sha256(item.title).slice(0, 8)}`,
        title: item.title,
        tokens,
        items: [item],
      });
      byUrl.set(item.url, clusters[clusters.length - 1]);
    }
  }

  // Nur Cluster mit mindestens einem neuen Item sind diese Stunde interessant.
  return clusters.filter((c) => c.items.some((i) => i.isNew));
}
