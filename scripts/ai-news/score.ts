/**
 * Phase 4: Regelbasiertes Scoring vor jedem Claude-Call (PLAN.md E29, E47).
 * score ≥ 0.65 → ai_triage · 0.45–<0.65 → monitor · sonst ignore.
 */
import type { Cluster, ClusterScore, SourceDef } from './types.ts';
import { envFloat, normalizeTitle, portalOf } from './util.ts';

const TRIAGE_THRESHOLD = envFloat('AI_NEWS_SCORE_THRESHOLD', 0.65);
const MONITOR_THRESHOLD = 0.45;

const RELEVANT_KEYWORDS =
  /\b(regierung|minister|kanzler|parlament|nationalrat|landtag|gesetz|wahl|koalition|budget|steuer|inflation|teuerung|arbeitsmarkt|arbeitslos|pension|gericht|urteil|prozess|staatsanwalt|studie|forschung|universität|klima|energie|strom|gas|eu|brüssel|export|industrie|bank|börse|insolvenz|tarif|streik|gesundheit|spital|pflege|bildung|schule|asyl|integration)\b/i;

// Tech-Begriffe geben nur einen halben Bonus: „KI" allein macht z. B. eine
// Ausstellungs-PR nicht nachrichtenrelevant (Miao-Ying-Lehre, PLAN.md E38).
const TECH_KEYWORDS = /\b(ki|künstliche intelligenz|digital|cyber|daten)\b/i;

// Chronik-/Blaulicht-Signale (E47, Wielandpark-Lehre): bewusst eng gehalten —
// nur Begriffe schwerer Ereignisse, damit Boulevard-Kleinmeldungen nicht
// pauschal geboostet werden (LOW_VALUE-Penalty bleibt unabhängig aktiv).
// Sabotage-/Anschlags-Begriffe ergänzt (Bahnsabotage-Lehre): die Köln-Story
// stand ohne Keyword-Treffer bei 0.55 und kam nie zur Triage.
const CHRONIK_KEYWORDS =
  /\b(polizei|festnahme|festgenommen|ermittlungen?|tatverdächtig\w*|messerangriff\w*|messerattacke\w*|messerstich\w*|lebensgefährlich\w*|schwer verletzt\w*|schwerverletzt\w*|amoklauf\w*|brandstiftung|wega|sabotage\w*|anschlag|anschläge\w*|brandanschlag\w*|bekennerschreiben|terror\w*|extremist\w*)\b/i;

const LOW_VALUE_KEYWORDS =
  /\b(promi|star|royal|adel|dschungelcamp|song contest|horoskop|rezept|gewinnspiel|fußball|bundesliga|champions league|ski|tennis|formel|olympia|match|spielbericht)\b/i;

// Erste Gruppe matcht auch als Kompositum-Bestandteil („Einzelausstellung",
// „Ausstellungseröffnung"); zweite nur am Wortanfang (sonst träfe z. B.
// „Vorlesung"); „gala" strikt begrenzt (sonst träfe „Galaxie").
const EVENT_PR_KEYWORDS =
  /ausstellung|vernissage|biennale|uraufführung|buchpräsentation|saisonprogramm|spielplan|eröffnung|\b(museum|museal|galerie|festival|konzert|premiere|lesung|jubiläum|eröffnet)|\bgalas?\b|tag der offenen tür/i;

// Große Sport-/Kultur-Ereignisse (E50): heben den LOW_VALUE/EVENT_PR-Malus additiv
// wieder an — aber nur so weit, dass ein Treffer die Triage-Schwelle erst ZUSAMMEN
// mit breiter Berichterstattung (≥2 Portale) + Frische reißt. Routine (Spielbericht,
// Ligaspiel, Einzelkonzert, Promi) fehlt diese Deckung und bleibt trotz Bonus unter
// der Schwelle. Bewusst eng: Championship-/Titel-/Weltrekord-Ebene, große Kulturpreise
// + Flaggschiff-Festivals — nicht jede Sportart, nicht jedes Konzert.
const MAJOR_EVENT_KEYWORDS =
  /\b(weltmeister\w*|europameister\w*|weltcup|weltrekord\w*|olympi\w*|medaille\w*|meistertitel|grand slam|nobelpreis\w*|welturaufführung|berlinale|viennale|oscars?|grammys?)\b|salzburger festspiele|bregenzer festspiele|goldene[rn]? (löwe|palme)/i;

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
  // Aussendung + genau 1 Medienportal ist das typische PR-Echo-Muster — Malus
  // statt Bonus; erst ≥2 unabhängige Medienportale zählen als Bestätigung.
  const mediaPortals = new Set(cluster.items.filter((i) => i.sourceType === 'media').map((i) => portalOf(i.sourceId)));
  if (mediaPortals.size >= 2 && types.has('press_release_wire')) {
    score += 0.1;
    reasons.push('multiple media + press release wire');
  } else if (mediaPortals.size === 1 && types.has('press_release_wire')) {
    score -= 0.1;
    reasons.push('single media portal + press release only');
  }
  if (RELEVANT_KEYWORDS.test(text)) {
    score += 0.1;
    reasons.push('relevant topic keywords');
  } else if (CHRONIK_KEYWORDS.test(text)) {
    score += 0.1;
    reasons.push('chronik/blaulicht keywords');
  } else if (TECH_KEYWORDS.test(text)) {
    score += 0.05;
    reasons.push('tech keywords');
  }
  if (NUMBER_SIGNAL.test(text)) {
    score += 0.05;
    reasons.push('quantitative claims');
  }
  if (LOW_VALUE_KEYWORDS.test(text)) {
    score -= 0.3;
    reasons.push('sport/celebrity/lifestyle penalty');
  }
  if (EVENT_PR_KEYWORDS.test(text)) {
    score -= 0.15;
    reasons.push('event/culture announcement penalty');
  }
  // Nach dem Malus: großes Sport-/Kultur-Ereignis hebt additiv wieder an (E50).
  if (MAJOR_EVENT_KEYWORDS.test(text)) {
    score += 0.2;
    reasons.push('major sport/culture event');
  }

  // Frische: jüngstes publishedAt im Cluster boostet aktuelle News,
  // ältere Lagen werden abgestuft (Items ohne Datum zählen neutral).
  const newest = Math.max(
    ...cluster.items.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : Number.NaN)).filter(Number.isFinite),
    Number.NEGATIVE_INFINITY,
  );
  if (Number.isFinite(newest)) {
    const ageHours = (Date.now() - newest) / 3_600_000;
    if (ageHours <= 3) {
      score += 0.1;
      reasons.push('fresh (<3h)');
    } else if (ageHours > 48) {
      score -= 0.2;
      reasons.push('stale (>48h)');
    } else if (ageHours > 24) {
      score -= 0.1;
      reasons.push('aging (>24h)');
    }
  }
  if (portals.size === 1 && types.has('press_release_wire') && !types.has('media')) {
    score -= 0.2;
    reasons.push('press release without second source');
  }

  score = Math.max(0, Math.min(1, score));
  // Inklusive Schwelle (E47): das Presse+Standard-Fragment der Wielandpark-Story
  // stand exakt bei 0.65 und fiel an der strikten Schwelle knapp durch.
  const recommendedAction = score >= TRIAGE_THRESHOLD ? 'ai_triage' : score >= MONITOR_THRESHOLD ? 'monitor' : 'ignore';
  return { score: Number(score.toFixed(3)), recommendedAction, reasons };
}
