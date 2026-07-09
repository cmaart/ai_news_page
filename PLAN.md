# Neue Nachrichten — Plan & Entscheidungslog

Statische, KI-gestützte Recherche-/News-Website. Astro + GitHub Pages. Domain (geplant): `neuenachrichten.at`.
Ergebnis der Grilling-Session vom 2026-07-09. Entscheidungen 25–36: Grilling-Session zur
AI-News-Pipeline (ebenfalls 2026-07-09), siehe Abschnitt „AI-News-Pipeline".

Design-Vorlagen: `docs/BELEG Artikelseite.html` + `docs/BELEG Startseite.html` (visuelle Referenz) · extrahierte Werte: `docs/design-tokens.md`

## Entscheidungen

| # | Thema | Entscheidung |
|---|-------|--------------|
| 1 | Design-Vorlage (BELEG Artikelseite.html) | Nur **visuell** übernehmen — Fonts, Farben, Styles **exakt** wie Vorlage. Alle Texte/Badges/Branding neu („Neue Nachrichten"). Redaktions-Framing der Vorlage („redaktionell geprüft") wird **nicht** übernommen; Default ist `editorialReview: none` → „Nicht redaktionell geprüft". |
| 2 | Datenhaltung | Alles im **MDX-Frontmatter**. Ein Artikel = eine Datei. Kein `data/research/`, keine Quellen-Registry (YAGNI). |
| 3 | Styling | **Vanilla CSS + Custom Properties** (Design-Tokens aus Vorlage). Kein Tailwind. Fonts **self-hosted via `@fontsource`** (Spectral, IBM Plex Sans, IBM Plex Mono) — DSGVO (kein Google-CDN). |
| 4 | Hosting | Repo: `github.com/cmaart/ai_news_page`, Deploy via GitHub Actions auf GitHub Pages. **Revidiert (2026-07-09):** `site`/`base` kommen im CI von `actions/configure-pages` (`SITE_URL`/`BASE_PATH`-Env) — ohne Custom Domain `cmaart.github.io/ai_news_page/`, mit Custom Domain automatisch Root, null Umstellung bei Go-Live. Interne Links immer über `withBase()` (`src/lib/url.ts`). Lokaler Fallback: `https://neuenachrichten.at`. DNS/CNAME = Go-Live-TODO. |
| 5 | Artikel-Anatomie | **Maximal strukturiert**: Kurzfazit, Claims, offene Fragen, Quellen, Korrekturen, Metriken im Frontmatter. MDX-Body = nur Fließtext. |
| 6 | Feedback-Link | **Nicht in v1.** Go-Live-TODO: GitHub-Issue-Template. Kein toter Link im UI. |
| 7 | schema.org | **`Article`**, nicht `NewsArticle` (kein journalistisches Publisher-Framing). `author` = Organization, `creativeWorkStatus` aus `status`. |
| 8 | RSS/Sitemap | **Standardintegrationen** `@astrojs/rss` + `@astrojs/sitemap`. Keine eigenen Generator-Scripts. |
| 9 | Validierung | Zod (Content-Collection-Schema) für Felder/Enums/URLs. `scripts/validate.ts` für Cross-Checks. **Ein** CI-Workflow: PR → validate+build; main → validate+build+deploy. |
| 10 | Topics/Länder | `topic`-Enum: `politik, wirtschaft, gesellschaft, technologie, wissenschaft` (Klima ⊂ Wissenschaft). `country`-Enum: `at, de, eu, int`. Topic-Seiten in v1. |
| 11 | URLs | Deutsch: `/artikel/<slug>/`, `/themen/<topic>/`, `/methodik/`, `/korrekturen/`, `/impressum/`, `/datenschutz/`, `/rss.xml`. `trailingSlash: 'always'`. |
| 12 | Startseite | Claim-Block + KI-Disclosure-Satz + Artikelcards (Stil „Weiterlesen"-Sektion der Vorlage). Sichtbarkeit: `draft`/`review` nirgends; `retracted` nur auf `/korrekturen` + Direkt-URL mit Retraction-Banner; `archived` nur Direkt-URL. Kein Pagination in v1. |
| 13 | Weglassen in v1 | Dark Mode (Tokens machen Nachrüsten trivial). Newsletter-Block (kein Backend). |
| 14 | Beispielartikel | 2 Stück, **fiktive Themen** (keine echten Institutionen mit erfundenen Zahlen): 1× `wissenschaft`/`published`, 1× `wirtschaft`/`corrected`. Keine Demo-Kennzeichnung (kurzlebig). |
| 15 | Metriken | `uncertainty`-Feld **gestrichen** (redundant zu `confidence`). Prüfband: Quellenstärke, Framing-Risiko, Konfidenz, Claim-Statistik (berechnet). Qualitative Unsicherheit = Sektion „Was noch unklar ist" (`openQuestions`). |
| 16 | AI-Disclosure | **Strukturell erzwungen**: Layout rendert Disclosure-Box immer, Text abgeleitet aus `generationMode` + `editorialReview` (zentral in `src/config/disclosure.ts`). Optionales Feld `aiDisclosureNote` für Ergänzungen. |
| 17 | Korrekturen | `corrections`-Array `{date, type: correction|update, text}` statt Einzelstring. `correction` ⇔ `status: corrected` (beidseitig validiert). `updatedAt` = jüngster Eintrag. Timeline im Artikel, Aggregation auf `/korrekturen`. |
| 18 | Body-Konvention | Freier Markdown-Fließtext mit `##`-Überschriften (kein h1). Layout rendert fixe Sektionsreihenfolge (siehe unten). |
| 19 | Rechtsseiten/Methodik | Impressum + Datenschutz als Platzhalter mit TODO-Markern. Methodik-Seite beschreibt intendierten Workflow ehrlich (kein Redaktions-Claim). |
| 20 | Analytics | **GA4 mit echtem Opt-in**: selbstgebauter Minimal-Cookie-Banner (Vanilla JS, localStorage, Widerruf via Footer-Link). Consent Mode v2, Default `denied`, GA lädt nur nach Akzeptieren. `PUBLIC_GA_ID` env; leer ⇒ Banner+GA deaktiviert. |
| 21 | Navigation | Header: Themen · Methodik · Korrekturen. `/themen/`-Übersichtsseite. „Über uns" gestrichen. Footer 4-spaltig wie Vorlage, Copyright-Zeile ohne „von Menschen verantwortet". |
| 22 | Versionen | **Immer aktuellste stable Versionen** (Stand Umsetzung: Astro 7, Zod 4 via astro:content, TS 7). Zod 4: `z.url()` statt `z.string().url()`; `render(entry)` standalone; Slug = `entry.id`. |
| 23 | Layout-Breite | Abweichend von Vorlage (1080/760/660px): **alle Container max 1024px**, Fließtext zusätzlich auf 72ch Lesebreite begrenzt. Card-Grids fluid (`auto-fill, minmax(280px, 1fr)`). |
| 24 | Positionierung | Produkt ist **News-Seite** („Nachrichten", „Artikel"), KI-Recherche ist Methode, nicht Produktname. Copy: „Aktuelle Nachrichten" statt „Aktuelle Recherchen"; Disclosure-/Methodik-Labels unverändert. |
| 25 | Pipeline-Workflow | Zweiter Workflow `.github/workflows/ai-news-research.yml`: alle 30 min (`cron: "7,37 * * * *"`, ursprünglich stündlich) + `workflow_dispatch`, `timeout-minutes: 30`, `concurrency`-Group ohne cancel. Tooling wie `deploy.yml`: **npm** (gepinnt 11.6.2), Node 24, `tsx`-Scripts unter `scripts/ai-news/`. |
| 26 | Quellen-Registry | **Revidiert Entscheidung 2 teilweise:** `data/ai-news/sources.yaml` als RSS-Registry (discovery-only, ~40 AT-Feeds: ORF/Standard/OTS aktiv, Presse/Kurier/Kleine/profil validation-gated, Boulevard disabled). Artikel-Daten bleiben im MDX-Frontmatter. |
| 27 | Rolling Memory | `data/ai-news/memory/` (seen-items 30 d, story-memory 90–180 d, source-health, run-history 500 Runs) wird **direkt auf main committet** — nie via PR-Branch (sonst Dedupe-Verlust bei ungemergtem PR). Inbox-/Cluster-JSONs **nicht** ins Git: nur Workflow-Artifacts (7 d, Debugging). Research-/Notes-JSONs als Audit-Beleg committen. |
| 28 | Recherche-Modell | Erst-Draft aus **RSS-Cluster-Aggregation** (Titel/Summaries mehrerer Portale; kein Artikeltext-Scraping). **Web-Search-Eskalation** (`web_search_20260209`) wenn Story ≥ 3 Portale erreicht oder Update ansteht: Primärquellen (AMS, Statistik Austria, Parlament, OTS-Volltext) aktiv suchen; Medienartikel lesen erlaubt (Verständnis, nie Nachdruck). Nur URLs aus Tool-Results zitieren. Deckel: max 8 Web-Search-Calls/Tag (Env). |
| 29 | Run-Budget | **Max 1 Story pro Run** (Draft *oder* Update) — top-gescorter Cluster, nur wenn Score > 0,65 (regelbasiertes Scoring vor Claude). Kein Tages-Artikelcap. Max 5 Triage-Calls/Run. Redraft-Sperre 24 h, Update-Throttle 6 h pro Story. |
| 30 | Auto-Publish | **Site ist vollständig AI-kuratiert.** Pipeline setzt `status: published` + `publishedAt` und committet **direkt auf main** — Gate ist `npm run validate` + `astro build` im Run (fail ⇒ kein Push). **Ausnahme `sensitivity: high`** (personenbezogene Vorwürfe, Gericht, Gesundheit, Minderjährige, …): `status: review`, eigener Branch `ai-news/<slug>` + PR (Labels `automated`, `news-research`, `needs-review`) für menschliches Gate. `deploy.yml` bekommt `paths-ignore: data/**` (Memory-only-Pushes deployen nicht). |
| 31 | Story-Updates | Bestehende Story ⇒ kein neuer Artikel. Update auch auf `published`: `corrections`-Eintrag `type: update`, `updatedAt`, Quellen ergänzt, Body angepasst — auto-committet (außer sensitiv ⇒ PR). Story-Zuordnung über story-memory. |
| 32 | Claude-Calls | **Revidiert (2026-07-09):** Calls laufen über **headless Claude Code CLI** (`claude -p`, Secret `CLAUDE_CODE_OAUTH_TOKEN` aus `claude setup-token`) — Abrechnung übers Claude-Abo statt API-Key. **Triage:** `claude-haiku-4-5` ohne Tools. **Draft/Update:** `claude-sonnet-5`, WebSearch-Tool nur bei Eskalation (E28). Kein API-erzwungenes JSON-Schema mehr ⇒ strikte JSON-Prompts + 1 Repair-Versuch + Shape-Validierung in `claude.ts`. |
| 33 | Pipeline-Frontmatter | Generierte Artikel nutzen das **bestehende Schema unverändert** — kein `slug`-/`uncertainty`-/`aiDisclosure`-Freitextfeld (Regel 1!). Pflicht: `summary` ≥ 1, `sources` ≥ 1, `claims` mit `sourceIds`-Referenzen, `generationMode: ai_generated`, `editorialReview: none`. |
| 34 | Slugs | Semantisch mit zeitlichem Qualifier wo sinnvoll (`ams-arbeitslosigkeit-juli-2026`), Script prüft Kollision gegen bestehende Dateien (Suffix `-2`). Kein Datums-Präfix. |
| 35 | Fehlerverhalten | Feed-Fehler ⇒ source-health + weiter (Auto-Disable nach x Fails). Claude-Fehler ⇒ Error-Note + weiter. validate/build fail ⇒ Job fail **vor** jedem Push. Benachrichtigung: GitHub-Failure-Mail des Scheduled Workflows. |
| 36 | Claude-Systemprompt-Regeln | Hart im Prompt: keine erfundenen Quellen/URLs/Zitate/Zahlen; keine Primärquellen-Behauptung ohne gelesene Primärquelle; vorsichtige Sprache; sensible Themen konservativ (niedrige confidence, eher Research Note); im Zweifel Note statt Artikel. Verbotene Formulierungen aus CLAUDE.md Regel 2 gelten auch für generierte Texte. |
| 37 | Textlängen-Varianten | **Revidiert E18 teilweise:** Jeder Artikel-Body enthält zwei Textlängen in MDX-Wrappern: `<Kompakt>` (reiner Fließtext, 2–3 Absätze, ca. 100–180 Wörter, keine Überschriften, keine Fakten über den Standard-Body hinaus) und `<Standard>` (##-Sektionen wie bisher). Nichts außerhalb der Wrapper. Umschalter „Kompakt \| Standard" (Segmented Toggle, `TextlaengeToggle.astro`) über dem Body; Auswahl site-weit in `localStorage` (`nn-textlaenge`), Default und No-JS-Fallback: standard. Umschalter tauscht **nur** den Fließtext — Kurzfazit, Prüfband, Disclosure, Claims, Quellen bleiben immer sichtbar. Beide Varianten stehen im gebauten HTML (`html[data-textlaenge]`-CSS in `global.css`). Pipeline: Draft **und** Update liefern `bodyKompakt` mit; `validate.ts` erzwingt Wrapper + Kompakt-Regeln hart. |

## Frontmatter-Schema (Zod, `src/content.config.ts`)

```yaml
title: string
description: string
publishedAt: date            # Pflicht ab status published
updatedAt: date?             # = Datum des jüngsten corrections-Eintrags
topic: politik | wirtschaft | gesellschaft | technologie | wissenschaft
country: at | de | eu | int
status: draft | review | published | corrected | retracted | archived
generationMode: ai_generated | ai_assisted | manually_reviewed
editorialReview: none | basic | full
confidence: low | medium | high
primarySourceStrength: none | weak | medium | strong
framingRisk: low | medium | high
summary:                     # Kurzfazit-Bullets
  - text: string
    kind: fact | open        # ✓ vs. ?
openQuestions: [string]      # „Was noch unklar ist"
sources:
  - id: string               # z. B. src1
    name: string
    type: agency | media | primary | official | study | press_release | other
    url: url
  # Primär/Sekundär-Gruppierung wird aus type abgeleitet:
  # primary/official/study/press_release → Primärquellen; media/agency/other → Sekundär
claims:
  - id: string
    text: string
    status: supported | partial | unclear | contradicted
    note: string?
    sourceIds: [string]      # muss auf sources.id zeigen
corrections:
  - date: datetime
    type: correction | update
    text: string
retractionReason: string?    # Pflicht bei status retracted
aiDisclosureNote: string?
```

Slug = Dateiname.

## Cross-Checks (`scripts/validate.ts`)

- jeder Artikel ≥ 1 Quelle
- jede `claim.sourceIds`-Referenz existiert
- `published`/`corrected` ⇒ `publishedAt` gesetzt
- `corrected` ⇔ ≥ 1 `corrections`-Eintrag mit `type: correction`
- `retracted` ⇒ `retractionReason` gesetzt
- `updatedAt` konsistent mit jüngstem `corrections`-Datum
- eindeutige Slugs

## Artikelseiten-Reihenfolge

1. Header · Topic/Country-Eyebrow · Titel · Description · Metadaten-Zeile
2. Prüfband (Quellenstärke, Framing-Risiko, Konfidenz, Claims x/y)
3. Disclosure-Box (abgeleitet)
4. Kurzfazit
5. Textlängen-Umschalter (E37) · **MDX-Body** (`<Kompakt>`-Fließtext bzw. `<Standard>` mit freien `##`-Sektionen)
6. Was noch unklar ist
7. Geprüfte Aussagen (Claims)
8. Methodikbox
9. Quellen (primär/sekundär)
10. Korrekturen & Updates
11. Weiterlesen (3 neueste andere Artikel)

Bei `retracted`: Retraction-Banner, kein normaler Artikel-Look.

## Projektstruktur

```
.github/workflows/deploy.yml     # PR: validate+build · main: +deploy (Pages)
scripts/validate.ts
src/
  config/disclosure.ts           # Standard-Disclosure-Texte
  content.config.ts              # Zod-Schema
  content/articles/*.mdx
  styles/global.css              # Tokens aus Vorlage
  layouts/BaseLayout.astro
  components/                    # Pruefband, DisclosureBox, ClaimList, SourceList,
                                 # OpenQuestions, CorrectionTimeline, MethodologyBox,
                                 # ArticleCard, RetractionBanner, CookieBanner, Analytics
  pages/
    index.astro
    artikel/[...slug].astro
    themen/index.astro
    themen/[topic].astro
    methodik.astro
    korrekturen.astro
    impressum.astro
    datenschutz.astro
    rss.xml.ts
public/robots.txt
astro.config.mjs                 # site, trailingSlash always, sitemap, mdx
```

Stack: Astro 5, MDX, TypeScript strict, npm, Node LTS.

## AI-News-Pipeline (Entscheidungen 25–36)

Ablauf pro Run (alle 30 min): RSS-Fetch (nur `enabled`-Feeds, 10 s Timeout, max 50 Items/Feed, URL-Normalisierung,
ID = sha256(sourceId+normalizedUrl)) → Dedupe gegen seen-items → Clustering (Token-Overlap, 48 h-Fenster)
→ regelbasiertes Scoring → Haiku-Triage (max 5) → max 1 Sonnet-Draft/Update → validate + build → Commit/Push
main (bzw. PR bei sensitiv) → Memory-Update.

```
.github/workflows/ai-news-research.yml
scripts/ai-news/{fetch-rss,cluster,score,triage,draft,run}.ts
data/ai-news/
  sources.yaml                 # Feed-Registry (E26)
  memory/                      # auf main committet (E27)
    seen-items.json  story-memory.json  source-health.json  run-history.jsonl
  research/YYYY-MM-DD/*.json   # Audit-Beleg pro Draft/Update
  notes/YYYY-MM-DD/*.json      # Research-/Error-Notes
```

Secret: `CLAUDE_CODE_OAUTH_TOKEN` (Repo-Secret, aus `claude setup-token`) — Abrechnung übers Claude-Abo,
Rate-Limits teilen sich mit der normalen Claude-Code-Nutzung.

**Offene Folge-Punkte (nicht Teil der Pipeline-Implementierung):**
- Startseite/Themen-Seiten brauchen bei unbegrenztem Artikelvolumen bald Pagination (revidiert E12/E23-Umfeld).
- Auto-Publish auf öffentlicher URL ohne fertiges Impressum/Datenschutz = presserechtliches Risiko (MedienG) —
  Go-Live-TODOs vorziehen oder Pipeline erst nach Rechtsseiten scharf schalten.
- Methodik-Seite an Auto-Publish-Realität anpassen (bisher beschreibt sie Review-Workflow).

## Go-Live-TODOs

- [ ] Domain `neuenachrichten.at` kaufen; DNS: A-Records auf GitHub-Pages-IPs + CNAME `www`; Custom Domain in Repo-Settings → Pages eintragen (`site`/`base` stellen sich dann automatisch um); `public/robots.txt` Sitemap-URL prüfen
- [x] GitHub Pages aktivieren (Source: GitHub Actions) — passiert automatisch beim ersten Workflow-Lauf (`configure-pages` mit `enablement: true`)
- [ ] Feedback-Link „Fehler oder fehlende Quelle melden": GitHub-Issue-Template (`korrektur.yml`, vorausgefüllt mit Slug) + Link-Komponente einbauen
- [ ] Newsletter: Anbieter wählen, Block reaktivieren
- [ ] **GA4 erst bei fixer Domain aktivieren**: Measurement-ID (`G-…`, nicht Property-ID) als
  Repo-Variable `PUBLIC_GA_ID` setzen — Code (Consent Mode v2 + Cookie-Banner) ist fertig und
  ohne Variable deaktiviert. Property 544960890 existiert bereits.
- [ ] Impressum mit echten Daten (§ 5 ECG, Offenlegung § 25 MedienG — Name/Anschrift Pflicht)
- [ ] Datenschutzerklärung finalisieren (GA4-Abschnitt, GitHub Pages als Hoster, Widerrufsweg)
- [x] Demo-Artikel entfernen/ersetzen
- [x] Echte Recherche-Pipeline (Scripts/GitHub Actions) — Design fixiert in Entscheidungen 25–36, implementiert und live
- [ ] Optional: Über-uns-Seite, Dark Mode, cookielose Analytics-Alternative evaluieren
