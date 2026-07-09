/**
 * Phase 4: Regelbasiertes Scoring vor jedem Claude-Call (PLAN.md E29).
 * score > 0.65 → ai_triage · 0.45–0.65 → monitor · sonst ignore.
 */
import type { Cluster, ClusterScore, SourceDef } from './types.ts';
import { envFloat, normalizeTitle, portalOf } from './util.ts';

const TRIAGE_THRESHOLD = envFloat('AI_NEWS_SCORE_THRESHOLD', 0.65);
const MONITOR_THRESHOLD = 0.45;

const RELEVANT_KEYWORDS =
  /\b(regierung|minister|kanzler|parlament|nationalrat|landtag|gesetz|wahl|koalition|budget|steuer|inflation|teuerung|arbeitsmarkt|arbeitslos|pension|gericht|urteil|prozess|staatsanwalt|studie|forschung|universität|klima|energie|strom|gas|ki|künstliche intelligenz|digital|cyber|daten|eu|brüssel|export|industrie|bank|börse|insolvenz|tarif|streik|gesundheit|spital|pflege|bildung|schule|asyl|integration)\b/i;

const LOW_VALUE_KEYWORDS =
  /\b(promi|star|royal|adel|dschungelcamp|song contest|horoskop|rezept|gewinnspiel|fußball|bundesliga|champions league|ski|tennis|formel|olympia|match|spielbericht)\b/i;

const NUMBER_SIGNAL = /\b\d+([.,]\d+)?\s*(prozent|%|euro|millionen|milliarden|mrd|mio)\b/i;

export function scoreCluster(cluster: Cluster, sourceById: Map<string, SourceDef>): ClusterScore {
  const reasons: string[] = [];
  const portals = new Set(cluster.items.map((i) => portalOf(i.sourceId)));
  const types = new Set(cluster.items.map((i) => i.sourceType));
  const weights = cluster.items.map((i) => sourceById.get(i.sourceId)?.weight ?? 0.5);
  const text = normalizeTitle(cluster.items.map((i) => `${i.title} ${i.summary ?? ''}`).join(' '));

  let score = Math.max(...weights) * 0.5;
  reasons.push(`max source weight ${Math.max(...weights)}`);

  if (portals.size >= 2) {
    score += Math.min((portals.size - 1) * 0.15, 0.3);
    reasons.push(`${portals.size} distinct portals`);
  }
  if (types.has('media') && types.has('press_release_wire')) {
    score += 0.1;
    reasons.push('media + press release wire');
  }
  if (RELEVANT_KEYWORDS.test(text)) {
    score += 0.1;
    reasons.push('relevant topic keywords');
  }
  if (NUMBER_SIGNAL.test(text)) {
    score += 0.05;
    reasons.push('quantitative claims');
  }
  if (LOW_VALUE_KEYWORDS.test(text)) {
    score -= 0.3;
    reasons.push('sport/celebrity/lifestyle penalty');
  }
  if (portals.size === 1 && types.has('press_release_wire') && !types.has('media')) {
    score -= 0.2;
    reasons.push('press release without second source');
  }

  score = Math.max(0, Math.min(1, score));
  const recommendedAction = score > TRIAGE_THRESHOLD ? 'ai_triage' : score >= MONITOR_THRESHOLD ? 'monitor' : 'ignore';
  return { score: Number(score.toFixed(3)), recommendedAction, reasons };
}
