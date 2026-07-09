/**
 * Claude-Calls (PLAN.md E32): Triage auf claude-haiku-4-5, Draft/Update auf
 * claude-sonnet-5 — beide mit Structured Output (output_config.format), damit
 * Enums/Pflichtfelder API-seitig erzwungen sind. Web-Search-Tool nur bei
 * Eskalation (E28): Story ≥ 3 Portale oder Update.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Cluster, DraftResult, Story, TriageResult } from './types.ts';

const TRIAGE_MODEL = 'claude-haiku-4-5';
const DRAFT_MODEL = 'claude-sonnet-5';

const client = new Anthropic();

const SHARED_RULES = `
Du arbeitest für „Neue Nachrichten“, eine statische News-Website (Sprache: Deutsch, de-AT),
deren Inhalte vollständig KI-gestützt erstellt und als solche gekennzeichnet werden.

Harte Regeln — keine Ausnahmen:
- RSS-Daten sind reine Discovery-Signale (Titel, Kurzzusammenfassung, URL). Nie Feed-Inhalte nachdrucken.
- Erfinde keine Quellen, keine URLs, keine Zitate, keine Zahlen, keine Namen.
- Behaupte keine Primärquellenprüfung, wenn du keine Primärquelle gelesen hast.
- Verwende vorsichtige, präzise Sprache: „laut vorliegenden Quellen“, „nicht abschließend verifiziert“.
- Verbotene Formulierungen (überall): „redaktionell geprüft“, „faktengeprüft“, „journalistisch verifiziert“,
  „garantiert objektiv“, „unabhängige Redaktion“, „wahr“.
- Sensible Themen (Kriminalität, personenbezogene Vorwürfe, Gesundheit, Migration, Krieg, Wahlen,
  Gerichtsverfahren, Minderjährige, Selbstschädigung, Finanz-/Anlageberatung, medizinische Aussagen):
  konservativ behandeln — keine Schuldzuweisungen, keine Namen von Privatpersonen aus RSS-Titeln,
  confidence niedriger ansetzen, sensitivity ehrlich als "high" markieren.
- Im Zweifel gegen den Artikel entscheiden.
`.trim();

// ---------------------------------------------------------------------------
// Triage (Haiku)
// ---------------------------------------------------------------------------

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'reason', 'sensitivity', 'possibleClaims', 'missingSources'],
  properties: {
    action: { type: 'string', enum: ['ignore', 'monitor', 'research_note', 'draft_article', 'update_story'] },
    reason: { type: 'string' },
    sensitivity: { type: 'string', enum: ['low', 'medium', 'high'] },
    possibleClaims: { type: 'array', items: { type: 'string' } },
    missingSources: { type: 'array', items: { type: 'string' } },
  },
} as const;

export async function triageCluster(cluster: Cluster, relatedStory: Story | undefined): Promise<TriageResult> {
  const input = {
    cluster: {
      title: cluster.title,
      items: cluster.items.map((i) => ({
        source: i.sourceId,
        sourceType: i.sourceType,
        title: i.title,
        summary: i.summary,
        url: i.url,
        publishedAt: i.publishedAt,
      })),
    },
    relatedStory: relatedStory
      ? {
          slug: relatedStory.slug,
          canonicalTitle: relatedStory.canonicalTitle,
          status: relatedStory.status,
          openQuestions: relatedStory.openQuestions,
          knownSourceUrls: relatedStory.sourceUrls,
        }
      : null,
  };

  const response = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 1500,
    system: `${SHARED_RULES}\n\nDeine Aufgabe: Triage eines Nachrichten-Clusters. Entscheide, ob sich ein Artikel lohnt.
- "update_story" nur, wenn relatedStory existiert und die neuen Items substanziell Neues liefern.
- "draft_article" nur bei ausreichend Substanz und öffentlicher Relevanz für Österreich/EU.
- Dünne Quellenlage oder reine Presseaussendung ohne Zweitquelle → "research_note" oder "monitor".
- Reiner Sport/Promi/Lifestyle → "ignore".`,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
    output_config: { format: { type: 'json_schema', schema: TRIAGE_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);

  return parseJsonResponse<TriageResult>(response);
}

// ---------------------------------------------------------------------------
// Draft / Update (Sonnet 5)
// ---------------------------------------------------------------------------

const SOURCE_TYPE_ENUM = ['agency', 'media', 'primary', 'official', 'study', 'press_release', 'other'];

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'slugSuggestion', 'title', 'description', 'topic', 'country', 'confidence',
    'primarySourceStrength', 'framingRisk', 'sensitivity', 'summary', 'openQuestions',
    'sources', 'claims', 'body', 'updateNote',
  ],
  properties: {
    slugSuggestion: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    topic: { type: 'string', enum: ['politik', 'wirtschaft', 'gesellschaft', 'technologie', 'wissenschaft'] },
    country: { type: 'string', enum: ['at', 'de', 'eu', 'int'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    primarySourceStrength: { type: 'string', enum: ['none', 'weak', 'medium', 'strong'] },
    framingRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
    sensitivity: { type: 'string', enum: ['low', 'medium', 'high'] },
    summary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'kind'],
        properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'open'] } },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'type', 'url'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: SOURCE_TYPE_ENUM },
          url: { type: 'string' },
        },
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'status', 'note', 'sourceIds'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          status: { type: 'string', enum: ['supported', 'partial', 'unclear', 'contradicted'] },
          note: { type: ['string', 'null'] },
          sourceIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    body: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'markdown'],
        properties: { heading: { type: 'string' }, markdown: { type: 'string' } },
      },
    },
    updateNote: { type: ['string', 'null'] },
  },
} as const;

const DRAFT_TASK = `
Deine Aufgabe: Erstelle aus dem Nachrichten-Cluster einen vollständigen Artikel für „Neue Nachrichten“.

Vorgaben:
- Sprache Deutsch (de-AT), nüchtern-präziser Ton wie eine gute Nachrichtenagentur mit offener Quellenlage.
- summary: 3–5 Kurzfazit-Bullets; kind "fact" nur für Belegtes, "open" für Offenes.
- sources: alle tatsächlich verwendeten Quellen mit korrekten IDs (src1, src2, …). Cluster-Items sind
  type "media" bzw. "press_release"; nur per Web-Suche gelesene offizielle Quellen dürfen
  "primary"/"official"/"study" sein.
- claims: 2–6 zentrale prüfbare Aussagen (claim1, claim2, …), status ehrlich; sourceIds müssen auf
  vorhandene sources-IDs zeigen. Ohne gelesene Primärquelle ist "supported" nur zulässig, wenn mehrere
  unabhängige Medien übereinstimmen — sonst "unclear"/"partial".
- body: 3–6 Sektionen mit ##-tauglichen Überschriften (z. B. „Was passiert ist“, „Was die Quellen zeigen“,
  „Was unklar bleibt“, „Einordnung“). Reiner Fließtext-Markdown ohne Überschriften-Zeichen im markdown-Feld.
- primarySourceStrength ehrlich: ohne gelesene Primärquelle maximal "weak".
- slugSuggestion: sprechend, kleingeschrieben, mit zeitlichem Qualifier wo sinnvoll
  (z. B. "ams-arbeitslosigkeit-juli-2026").
- updateNote: null bei neuem Artikel.
`.trim();

const UPDATE_TASK = `
Deine Aufgabe: Aktualisiere den bestehenden Artikel anhand der neuen Quellenlage (Cluster-Items unten).
- Gib den VOLLSTÄNDIGEN aktualisierten Artikel zurück (alle Felder, kompletter body).
- Bestehende korrekte Inhalte beibehalten; Neues integrieren; Überholtes präzisieren.
- sources: bestehende behalten (IDs stabil lassen), neue ergänzen.
- updateNote: ein Satz, was sich geändert hat — wird als öffentlicher „Update“-Eintrag angezeigt.
- slugSuggestion: unverändert der bestehende Slug.
`.trim();

const WEB_SEARCH_GUIDANCE = `
Du hast Zugriff auf Web-Suche. Nutze sie gezielt (max. 6 Suchen):
- Suche Primärquellen: Behörden (AMS, Statistik Austria, Ministerien, Parlament), offizielle
  Presseaussendungen (OTS-Volltexte sind frei zugänglich), Studien, Gerichtsdokumente.
- Medienartikel darfst du zum Verständnis lesen, aber nie nachdrucken — eigenständig formulieren,
  mit Quellenangabe.
- Zitiere ausschließlich URLs, die du tatsächlich über die Suche gesehen hast.
`.trim();

export interface DraftCallResult {
  draft: DraftResult;
  webSearchUsed: number;
}

export async function draftOrUpdate(options: {
  cluster: Cluster;
  triage: TriageResult;
  existingArticle?: { slug: string; frontmatterYaml: string; body: string };
  useWebSearch: boolean;
}): Promise<DraftCallResult> {
  const { cluster, triage, existingArticle, useWebSearch } = options;

  const input = {
    mode: existingArticle ? 'update' : 'new_article',
    cluster: {
      title: cluster.title,
      items: cluster.items.map((i) => ({
        source: i.sourceId,
        sourceType: i.sourceType,
        title: i.title,
        summary: i.summary,
        url: i.url,
        publishedAt: i.publishedAt,
      })),
    },
    triage: { reason: triage.reason, possibleClaims: triage.possibleClaims, missingSources: triage.missingSources },
    existingArticle: existingArticle
      ? { slug: existingArticle.slug, frontmatter: existingArticle.frontmatterYaml, body: existingArticle.body }
      : null,
  };

  const system = [
    SHARED_RULES,
    existingArticle ? UPDATE_TASK : DRAFT_TASK,
    useWebSearch ? WEB_SEARCH_GUIDANCE : 'Du hast KEINE Web-Suche. Arbeite ausschließlich mit den Cluster-Metadaten und kennzeichne die Quellenlage entsprechend vorsichtig (primarySourceStrength maximal "weak", Claims eher "unclear").',
  ].join('\n\n');

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: DRAFT_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
    output_config: { format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
    ...(useWebSearch
      ? { tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 6 }] }
      : {}),
  } as Anthropic.MessageCreateParamsNonStreaming;

  let response = await client.messages.create(params);

  // Server-Tool-Loop: bei pause_turn Assistant-Turn anhängen und fortsetzen.
  let continuations = 0;
  while (response.stop_reason === 'pause_turn' && continuations < 5) {
    continuations += 1;
    response = await client.messages.create({
      ...params,
      messages: [...params.messages, { role: 'assistant', content: response.content }],
    });
  }

  const webSearchUsed = countWebSearches(response);
  return { draft: parseJsonResponse<DraftResult>(response), webSearchUsed };
}

// ---------------------------------------------------------------------------

function parseJsonResponse<T>(response: Anthropic.Message): T {
  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (textBlocks.length === 0) {
    throw new Error(`Claude-Antwort ohne Textblock (stop_reason=${response.stop_reason})`);
  }
  return JSON.parse(textBlocks[textBlocks.length - 1].text) as T;
}

function countWebSearches(response: Anthropic.Message): number {
  const usage = response.usage as unknown as { server_tool_use?: { web_search_requests?: number } };
  return usage.server_tool_use?.web_search_requests ?? 0;
}
