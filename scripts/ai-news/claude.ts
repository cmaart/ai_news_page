/**
 * Claude-Calls (PLAN.md E32, revidiert): laufen über headless Claude Code CLI
 * (`claude -p`) mit CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) statt über
 * die Messages API — Abrechnung übers Claude-Abo.
 *
 * Konsequenz: kein API-seitig erzwungenes JSON-Schema mehr. Stattdessen
 * strikte JSON-Prompts + Parse mit einem Repair-Versuch + Shape-Validierung.
 * Triage: claude-haiku-4-5 · Draft/Update: claude-sonnet-5 (+ WebSearch-Tool
 * bei Eskalation, E28).
 */
import { spawn } from 'node:child_process';
import type { Cluster, DraftResult, RelatedCandidate, TriageResult } from './types.ts';

const TRIAGE_MODEL = 'claude-haiku-4-5';
const DRAFT_MODEL = 'claude-sonnet-5';

const TRIAGE_TIMEOUT_MS = 120_000;
const DRAFT_TIMEOUT_MS = 480_000;

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
  Claims konservativer einstufen (eher "partial"/"unclear"), sensitivity ehrlich als "high" markieren.
  Sensibilität drosselt NICHT die confidence — die misst ausschließlich die Quellenlage (E41).
- Im Zweifel gegen den Artikel entscheiden.

Antworte AUSSCHLIESSLICH mit einem einzigen validen JSON-Objekt — kein Markdown, keine Code-Fences,
kein Text davor oder danach.
`.trim();

// ---------------------------------------------------------------------------
// Headless-CLI-Aufruf
// ---------------------------------------------------------------------------

interface ClaudeCliOptions {
  model: string;
  systemPrompt: string;
  allowWebSearch: boolean;
  timeoutMs: number;
}

async function runClaude(prompt: string, options: ClaudeCliOptions): Promise<string> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', options.model,
    '--system-prompt', options.systemPrompt,
  ];
  if (options.allowWebSearch) {
    args.push('--allowedTools', 'WebSearch', '--max-turns', '15');
  } else {
    args.push('--max-turns', '2');
  }

  const stdout = await execClaude(args, prompt, options.timeoutMs);
  const envelope = JSON.parse(stdout) as { result?: string; is_error?: boolean; subtype?: string };
  if (envelope.is_error || typeof envelope.result !== 'string') {
    throw new Error(`Claude-CLI-Fehler (${envelope.subtype ?? 'unbekannt'}): ${stdout.slice(0, 300)}`);
  }
  return envelope.result;
}

function execClaude(args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      shell: process.platform === 'win32',
      env: process.env,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Claude-CLI-Timeout nach ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Claude-CLI Exit ${code}: ${(err || out).slice(0, 300)}`));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** JSON aus der Antwort ziehen (Code-Fences tolerieren), 1× Repair-Versuch. */
async function runClaudeJson<T>(prompt: string, options: ClaudeCliOptions): Promise<T> {
  const first = await runClaude(prompt, options);
  try {
    return extractJson<T>(first);
  } catch (error) {
    const repairPrompt = `${prompt}\n\nDeine letzte Antwort war kein valides JSON (${(error as Error).message.slice(0, 120)}). Antworte jetzt AUSSCHLIESSLICH mit dem geforderten JSON-Objekt.`;
    const second = await runClaude(repairPrompt, options);
    return extractJson<T>(second);
  }
}

function extractJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('kein JSON-Objekt gefunden');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

// ---------------------------------------------------------------------------
// Triage (Haiku)
// ---------------------------------------------------------------------------

const TRIAGE_FORMAT = `
JSON-Format (alle Felder Pflicht; "relatedSlug" darf null sein):
{
  "action": "ignore" | "monitor" | "research_note" | "draft_article" | "update_story",
  "reason": string,
  "sensitivity": "low" | "medium" | "high",
  "newsworthiness": 1 | 2 | 3 | 4 | 5,
  "resonance": 1 | 2 | 3 | 4 | 5 | null,
  "relatedSlug": string | null,
  "possibleClaims": string[],
  "missingSources": string[]
}
`.trim();

const TRIAGE_ACTIONS = new Set(['ignore', 'monitor', 'research_note', 'draft_article', 'update_story']);
const SENSITIVITIES = new Set(['low', 'medium', 'high']);

export async function triageCluster(
  cluster: Cluster,
  relatedStories: RelatedCandidate[],
  echo?: { slug: string; publishers24h: number },
): Promise<TriageResult> {
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
        fulltextExcerpt: i.fulltext,
      })),
    },
    // Verwandte bereits publizierte Stories (E53) — Kandidaten für Update vs. Delta.
    relatedStories: relatedStories.map((s) => ({
      slug: s.slug,
      canonicalTitle: s.canonicalTitle,
      status: s.status,
      hasPublishedArticle: s.hasPublishedArticle,
      openQuestions: s.openQuestions,
      /** Deterministisch gezählte distinkte Portale mit Folge-Items in 24 h (E46). */
      echoPublishers24h: s.slug === echo?.slug ? echo.publishers24h : 0,
    })),
  };

  const systemPrompt = `${SHARED_RULES}\n\nDeine Aufgabe: Triage eines Nachrichten-Clusters. Entscheide, ob sich ein Artikel lohnt.
- Einzelne Items können "fulltextExcerpt" enthalten (abgerufener Artikeltext-Auszug). Nutze ihn,
  um Substanz, Konkretheit und Quellenlage zu beurteilen — er ist Beurteilungsgrundlage, nie
  Nachdruck-Material. Fehlt er, gilt weiterhin: nur Discovery-Signale.
- "relatedStories" sind bereits publizierte Artikel, die dieser Cluster fortsetzen KÖNNTE (nur Kandidaten,
  nicht zwingend zutreffend). Prüfe, ob der Cluster wirklich dieselbe Story fortführt (gleiches Ereignis,
  Reaktion darauf, neues Detail). Wenn ja: setze "relatedSlug" auf den Slug des passenden Kandidaten und
  entscheide zwischen "update_story" und "draft_article" nach der Regel unten. Wenn kein Kandidat wirklich
  passt: "relatedSlug": null.
- Update-vor-Delta (E53): Ein Bezug zu einer publizierten Story wird STANDARDMÄSSIG mit "update_story"
  behandelt — die neue Entwicklung wird in den bestehenden Artikel integriert. Wähle "draft_article" für eine
  verwandte Story NUR dann, wenn die neue Wendung eine eigene Schlagzeile rechtfertigt (neuer Hauptakteur,
  neues Teil-Ereignis mit eigenständigem Nachrichtenwert) — nicht für inkrementelle Details, Zwischenstände
  oder Reaktionen, die eine offene Frage der bestehenden Story beantworten. Im Zweifel "update_story".
- "update_story" setzt einen passenden relatedSlug voraus (Kandidat mit hasPublishedArticle=true) und dass
  die neuen Items substanziell Neues liefern.
- "draft_article" bei ausreichend Substanz und öffentlicher Relevanz für Österreich/EU — mit relatedSlug,
  wenn es eine eigenständige neue Wendung einer bekannten Story ist, sonst mit relatedSlug null (echte
  Erststory).
- Dünne Quellenlage oder reine Presseaussendung ohne Zweitquelle → "research_note" oder "monitor".
- Routine-Sport (Spielberichte, Ligaspiele, einzelne Etappen/Matches, Transfers), reiner Promi/Lifestyle → "ignore".
- AUSNAHME Großereignisse: Sport-Titel-/Championship-Ebene (WM/EM/Weltcup, Olympia-Titel oder -Medaille,
  Grand-Slam-Titel wie Wimbledon-/French-Open-Finale, Weltrekord, Meistertitel) und große Kulturereignisse
  (Nobelpreis, Berlinale, Viennale, Salzburger/Bregenzer Festspiele, Oscar, Grammy, Goldener Löwe/Palme)
  rechtfertigen "draft_article" auch OHNE direkten Österreich-Bezug — sofern die Berichterstattung breit ist
  (≥2 unabhängige Portale). Hier zählt globale Bedeutung als Relevanz; nicht auf Österreich/EU einengen.
- "newsworthiness" (Nachrichtenwert 1–5, unabhängig von sensitivity):
  5 = weitreichende Bedeutung für Österreich/EU (Regierungsentscheidung, große Wirtschafts-/Arbeitsmarktlage) ·
  4 = klare öffentliche Relevanz, viele Betroffene · 3 = solide Nachricht mit begrenzter Reichweite ·
  2 = Nischenthema, geringe Konsequenzen · 1 = Termin-/Event-Ankündigung, Kultur-/Produkt-PR ohne Nachrichtenwert.
  Event-/Ausstellungs-/Kultur-Ankündigungen und Presseaussendungen ohne gesellschaftliche Konsequenz: 1–2.
  Sport-/Kultur-Großereignisse (siehe Ausnahme oben): mindestens 3, bei weltweiter Dominanz 4.
- "resonance" (beobachtetes Medienecho, E46) NUR wenn der Cluster eine relatedStory mit
  hasPublishedArticle=true fortsetzt (relatedSlug gesetzt), sonst null. Beurteile die Qualität des Echos auf
  den bereits publizierten Artikel anhand der neuen Items:
  1 = kein nennenswertes Echo ODER reine Agentur-Syndikation (mehrere Portale mit erkennbar demselben
  Agenturtext zählen als EIN Echo) · 3 = mehrere unabhängige, eigenständige Folgeberichte ·
  5 = Story dominiert die Nachrichtenlage (breite unabhängige Berichterstattung, Reaktionen, Analysen).
  "echoPublishers24h" ist die rohe deterministische Portal-Zählung — korrigiere sie nach unten, wenn das
  Echo nur Syndikation ist, und nach oben, wenn eigenständige Reaktionen/Analysen dazukommen.
  resonance ist reine Beobachtung des Echos — unabhängig von newsworthiness und sensitivity.\n\n${TRIAGE_FORMAT}`;

  const result = await runClaudeJson<TriageResult>(JSON.stringify(input), {
    model: TRIAGE_MODEL,
    systemPrompt,
    allowWebSearch: false,
    timeoutMs: TRIAGE_TIMEOUT_MS,
  });

  if (!TRIAGE_ACTIONS.has(result.action) || !SENSITIVITIES.has(result.sensitivity)) {
    throw new Error(`Triage-Antwort außerhalb des Schemas: ${JSON.stringify(result).slice(0, 200)}`);
  }
  result.possibleClaims ??= [];
  result.missingSources ??= [];
  // relatedSlug (E53) hart gegen die vorgelegten Kandidaten prüfen — Halluzinationen
  // verwerfen. Nur ein Slug mit publiziertem Artikel darf Update-/Delta-Bezug tragen.
  const publishedSlugs = new Set(relatedStories.filter((s) => s.hasPublishedArticle).map((s) => s.slug));
  result.relatedSlug =
    typeof result.relatedSlug === 'string' && publishedSlugs.has(result.relatedSlug) ? result.relatedSlug : null;
  // Weiches Feld: coercen und clampen statt Run abbrechen; fehlend/NaN → 3.
  const news = Math.round(Number(result.newsworthiness));
  result.newsworthiness = Number.isFinite(news) ? Math.min(5, Math.max(1, news)) : 3;
  // resonance ebenso weich: nur übernehmen, wenn ein relatedSlug mit Artikel dranhängt (E46).
  if (result.resonance != null && result.relatedSlug) {
    const res = Math.round(Number(result.resonance));
    result.resonance = Number.isFinite(res) ? Math.min(5, Math.max(1, res)) : null;
  } else {
    result.resonance = null;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Draft / Update (Sonnet 5)
// ---------------------------------------------------------------------------

const DRAFT_FORMAT = `
JSON-Format (alle Felder Pflicht; "note" und "updateNote" dürfen null sein):
{
  "slugSuggestion": string,
  "title": string,
  "description": string,
  "topic": "politik" | "wirtschaft" | "gesellschaft" | "technologie" | "wissenschaft" | "sport" | "kultur",
  "country": "at" | "de" | "eu" | "int",
  "confidence": "low" | "medium" | "high",
  "confidenceNote": string,
  "primarySourceStrength": "none" | "weak" | "medium" | "strong",
  "sourceStrengthNote": string,
  "framingRisk": "low" | "medium" | "high",
  "framingRiskNote": string,
  "sensitivity": "low" | "medium" | "high",
  "summary": [{ "text": string, "kind": "fact" | "open" }],
  "openQuestions": string[],
  "sources": [{ "id": string, "name": string, "type": "agency" | "media" | "primary" | "official" | "study" | "press_release" | "other", "url": string }],
  "claims": [{ "id": string, "text": string, "status": "supported" | "partial" | "unclear" | "contradicted", "note": string | null, "sourceIds": string[] }],
  "body": [{ "heading": string, "markdown": string }],
  "bodyKompakt": string,
  "updateNote": string | null
}
`.trim();

const DRAFT_TASK = `
Deine Aufgabe: Erstelle aus dem Nachrichten-Cluster einen vollständigen Artikel für „Neue Nachrichten“.

Vorgaben:
- Sprache Deutsch (de-AT), nüchtern-präziser Ton wie eine gute Nachrichtenagentur mit offener Quellenlage.
- topic: Digital-/IT-/KI-Themen als Gegenstand der Story → "technologie" (KI-Forschung und KI-Paper
  zählen hierher, nicht zu "wissenschaft"). Dominiert aber ein politischer oder wirtschaftlicher
  Kontext (z. B. Regulierungsstrafe, Cyberangriff auf eine Behörde, Quartalszahlen eines Tech-Konzerns),
  gewinnt der Kontext → "politik" bzw. "wirtschaft". "wissenschaft" = Forschung außerhalb der
  Digital-Welt (Naturwissenschaft, Medizin, Klima, Raumfahrt).
  "sport" = Sport als Gegenstand (Ergebnisse, Transfers, Events, Sportler als Person des öffentlichen
  Lebens). Dominiert aber Unglück, Kriminalität oder Politik (tödlicher Rennunfall, Doping-Ermittlung,
  Sport-Boykott als Staatsakt), gewinnt der Kontext → altes Ressort (meist "gesellschaft" bzw. "politik").
  "kultur" = Musik, Film, Theater, Kunst, Literatur, Kulturbetrieb und -institutionen (absorbiert Musik).
  Reines Kulturereignis/-betrieb → "kultur"; gesellschaftliche Debatte drumherum → "gesellschaft".
- summary: 3–5 Kurzfazit-Bullets; kind "fact" nur für Belegtes, "open" für Offenes.
- sources: alle tatsächlich verwendeten Quellen mit korrekten IDs (src1, src2, …). Cluster-Items sind
  type "media" bzw. "press_release"; nur per Web-Suche gelesene offizielle Quellen dürfen
  "primary"/"official"/"study" sein.
- claims: 2–6 zentrale prüfbare Aussagen (claim1, claim2, …), status ehrlich; sourceIds müssen auf
  vorhandene sources-IDs zeigen. Ohne gelesene Primärquelle ist "supported" nur zulässig, wenn mehrere
  unabhängige Medien übereinstimmen — sonst "unclear"/"partial".
- body: 3–6 Sektionen mit ##-tauglichen Überschriften (z. B. „Was passiert ist“, „Was die Quellen zeigen“,
  „Was unklar bleibt“, „Einordnung“). Reiner Fließtext-Markdown ohne Überschriften-Zeichen im markdown-Feld.
- bodyKompakt: Kompakt-Fassung desselben Artikels als reiner Fließtext — 2 bis 3 Absätze
  (durch Leerzeilen getrennt, insgesamt ca. 100–180 Wörter), KEINE Überschriften, keine Listen.
  Nur Fakten, die auch im body stehen; Quellenlage-Vorbehalte beibehalten.
- primarySourceStrength ehrlich: ohne gelesene Primärquelle maximal "weak".
- slugSuggestion: sprechend, kleingeschrieben, mit zeitlichem Qualifier wo sinnvoll
  (z. B. "ams-arbeitslosigkeit-juli-2026").
- updateNote: null bei neuem Artikel.

Metrik-Regeln (E41) — confidence, primarySourceStrength und framingRisk nach diesen Rubriken vergeben,
jeweils mit einem Begründungssatz (confidenceNote/sourceStrengthNote/framingRiskNote, Pflicht,
lesertauglich, ohne Fachjargon):
- confidence ist REIN epistemisch: Wie sicher ist die Gesamtdarstellung nach vorliegender Quellenlage?
  Ein Ereignis gilt als bestätigt, wenn (a) die handelnde Institution es selbst verkündet
  (eigene Aussendung, Dokument, Urteil), oder (b) eine APA-Agenturmeldung es trägt, oder
  (c) zwei voneinander unabhängige Quellen es berichten. Mehrere Portale, die erkennbar dieselbe
  Agenturmeldung wiedergeben, zählen als EINE Quelle. Themen-Sensibilität senkt confidence nicht.
- OTS ist KEINE APA-Agenturmeldung, sondern ungeprüfte Presseaussendung des Absenders:
  Institution verkündet eigenes Handeln ⇒ zählt wie (a); Behauptung über Dritte ⇒ nur eine
  Parteistimme — treibt framingRisk nach oben, nicht confidence.
- framingRisk-Rubrik: "low" = mehrere unabhängige Perspektiven, Gegenseite aus direkt eingesehener
  Quelle · "medium" = eine Perspektive dominiert die Quellenlage ODER Gegenseite nur aus zweiter
  Hand · "high" = nur Darstellung einer Seite, Gegenseite fehlt.
`.trim();

const UPDATE_TASK = `
Deine Aufgabe: Aktualisiere den bestehenden Artikel anhand der neuen Quellenlage (Cluster-Items unten).
- Gib den VOLLSTÄNDIGEN aktualisierten Artikel zurück (alle Felder, kompletter body UND bodyKompakt).
- Der bestehende Body enthält beide Textlängen in <Kompakt>/<Standard>-Wrappern; gib body (Standard-
  Sektionen) und bodyKompakt getrennt und OHNE Wrapper-Tags zurück. Beide müssen den neuen Stand abbilden.
- Bestehende korrekte Inhalte beibehalten; Neues integrieren; Überholtes präzisieren.
- sources: bestehende behalten (IDs stabil lassen), neue ergänzen.
- updateNote: ein Satz, was sich geändert hat — wird als öffentlicher „Update“-Eintrag angezeigt.
- slugSuggestion: unverändert der bestehende Slug.
`.trim();

const DELTA_TASK = `
Deine Aufgabe: Erstelle einen EIGENSTÄNDIGEN Artikel zu einer NEUEN Wendung einer bereits publizierten Story
(„Delta-Artikel", PLAN.md E53). Der bestehende Artikel bleibt unverändert bestehen; dein Artikel ist NICHT sein
Ersatz und NICHT seine Wiederholung, sondern behandelt gezielt das NEUE.

Der Block "relatedArticle" beschreibt den bereits publizierten Artikel: sein Titel, seine Kurzfazit-Bullets
(summary) und seine offenen Fragen (openQuestions). Diese Inhalte gelten als BEREITS BERICHTET —
wiederhole sie NICHT und erzähle den bekannten Hergang NICHT noch einmal nach. Setze sie voraus.

- Eröffne mit der NEUEN Entwicklung (das, was der aktuelle Cluster liefert) — nicht mit „Was passiert ist"
  oder einer Nacherzählung des Ausgangsereignisses.
- Höchstens EIN kurzer Absatz „Vorgeschichte/Hintergrund", der den bekannten Kontext knapp zusammenfasst und
  auf den bestehenden Artikel verweist (formuliere den Verweis textlich, z. B. „wie im bisherigen Bericht
  dargestellt" — den klickbaren Link setzt die Website automatisch, gib KEINE URL und KEIN Markdown-Link aus).
- Wenn die neue Wendung eine offene Frage des bestehenden Artikels beantwortet, mach das explizit sichtbar.
- Alle übrigen Draft-Regeln gelten wie beim neuen Artikel (siehe unten: sources, claims, summary, body,
  bodyKompakt, Metriken E41). slugSuggestion: sprechend und auf die NEUE Wendung gemünzt, mit zeitlichem
  Qualifier. updateNote: null (dies ist ein neuer Artikel, kein Update).
`.trim();

const WEB_SEARCH_GUIDANCE = `
Du hast das WebSearch-Tool. Nutze es gezielt (max. 6 Suchen):
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

export interface RelatedArticleContext {
  slug: string;
  title: string;
  summary: { text: string; kind: 'fact' | 'open' }[];
  openQuestions: string[];
}

export async function draftOrUpdate(options: {
  cluster: Cluster;
  triage: TriageResult;
  existingArticle?: { slug: string; frontmatterYaml: string; body: string };
  /** E53: bei einem Delta-Artikel der bereits publizierte verwandte Artikel (nur Kontext, kein Update-Ziel). */
  relatedArticle?: RelatedArticleContext;
  useWebSearch: boolean;
}): Promise<DraftCallResult> {
  const { cluster, triage, existingArticle, relatedArticle, useWebSearch } = options;
  const isDelta = !existingArticle && !!relatedArticle;

  const input = {
    mode: existingArticle ? 'update' : isDelta ? 'delta_article' : 'new_article',
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
    // E53: „bereits berichtet" — Titel/summary/openQuestions, NICHT der volle Body (Abschreib-/Urheberrisiko).
    relatedArticle: isDelta
      ? {
          slug: relatedArticle!.slug,
          title: relatedArticle!.title,
          summary: relatedArticle!.summary,
          openQuestions: relatedArticle!.openQuestions,
        }
      : null,
  };

  const systemPrompt = [
    SHARED_RULES,
    existingArticle ? UPDATE_TASK : isDelta ? DELTA_TASK : DRAFT_TASK,
    useWebSearch
      ? WEB_SEARCH_GUIDANCE
      : 'Du hast KEINE Web-Suche. Arbeite ausschließlich mit den Cluster-Metadaten und kennzeichne die Quellenlage entsprechend vorsichtig (primarySourceStrength maximal "weak", Claims eher "unclear").',
    DRAFT_FORMAT,
  ].join('\n\n');

  const draft = await runClaudeJson<DraftResult>(JSON.stringify(input), {
    model: DRAFT_MODEL,
    systemPrompt,
    allowWebSearch: useWebSearch,
    timeoutMs: DRAFT_TIMEOUT_MS,
  });

  assertDraftShape(draft);
  // CLI liefert keine Suchanzahl — Budget zählt Draft-Calls mit aktivierter Suche.
  return { draft, webSearchUsed: useWebSearch ? 1 : 0 };
}

const TOPICS = new Set(['politik', 'wirtschaft', 'gesellschaft', 'technologie', 'wissenschaft', 'sport', 'kultur']);
const COUNTRIES = new Set(['at', 'de', 'eu', 'int']);
const LEVELS = new Set(['low', 'medium', 'high']);
const SOURCE_STRENGTHS = new Set(['none', 'weak', 'medium', 'strong']);
const SOURCE_TYPES = new Set(['agency', 'media', 'primary', 'official', 'study', 'press_release', 'other']);
const CLAIM_STATUS = new Set(['supported', 'partial', 'unclear', 'contradicted']);

function assertDraftShape(draft: DraftResult): void {
  const problems: string[] = [];
  if (!draft.title?.trim()) problems.push('title fehlt');
  if (!draft.description?.trim()) problems.push('description fehlt');
  if (!TOPICS.has(draft.topic)) problems.push(`topic ungültig: ${draft.topic}`);
  if (!COUNTRIES.has(draft.country)) problems.push(`country ungültig: ${draft.country}`);
  if (!LEVELS.has(draft.confidence)) problems.push(`confidence ungültig: ${draft.confidence}`);
  if (!SOURCE_STRENGTHS.has(draft.primarySourceStrength)) problems.push(`primarySourceStrength ungültig: ${draft.primarySourceStrength}`);
  if (!LEVELS.has(draft.framingRisk)) problems.push(`framingRisk ungültig: ${draft.framingRisk}`);
  if (!draft.confidenceNote?.trim()) problems.push('confidenceNote fehlt');
  if (!draft.sourceStrengthNote?.trim()) problems.push('sourceStrengthNote fehlt');
  if (!draft.framingRiskNote?.trim()) problems.push('framingRiskNote fehlt');
  if (!LEVELS.has(draft.sensitivity)) problems.push(`sensitivity ungültig: ${draft.sensitivity}`);
  if (!Array.isArray(draft.summary) || draft.summary.length === 0) problems.push('summary leer');
  if (!Array.isArray(draft.sources) || draft.sources.length === 0) problems.push('sources leer');
  if (!Array.isArray(draft.body) || draft.body.length === 0) problems.push('body leer');
  if (typeof draft.bodyKompakt !== 'string' || !draft.bodyKompakt.trim()) problems.push('bodyKompakt leer');
  for (const s of draft.sources ?? []) {
    if (!SOURCE_TYPES.has(s.type)) problems.push(`source type ungültig: ${s.type}`);
  }
  for (const c of draft.claims ?? []) {
    if (!CLAIM_STATUS.has(c.status)) problems.push(`claim status ungültig: ${c.status}`);
  }
  if (problems.length > 0) throw new Error(`Draft außerhalb des Schemas: ${problems.join('; ')}`);
}
