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
| 30 | Auto-Publish | **Site ist vollständig AI-kuratiert.** Pipeline setzt `status: published` + `publishedAt` und committet **direkt auf main** — Gate ist `npm run validate` + `astro build` im Run (fail ⇒ kein Push). **Revidiert (2026-07-11):** Die frühere `sensitivity: high`-Ausnahme (Branch `ai-news/<slug>` + Review-PR als menschliches Gate, eingeführt 2026-07-10) ist **entfernt** — alle Artikel publizieren direkt auf main, `sensitivity` bleibt nur pipeline-intern (Tonalität/Claim-Einstufung, E41). `status: review` wird nirgends mehr geschrieben (weder Frontmatter noch story-memory; Alt-Einträge im Memory bleiben als Legacy). `deploy.yml` behält `paths-ignore: data/**` (Memory-only-Pushes deployen nicht). |
| 31 | Story-Updates | Bestehende Story ⇒ kein neuer Artikel. Update auch auf `published`: `corrections`-Eintrag `type: update`, `updatedAt`, Quellen ergänzt, Body angepasst — auto-committet (auch sensitiv, E30 revidiert 2026-07-11). Story-Zuordnung über story-memory. |
| 32 | Claude-Calls | **Revidiert (2026-07-09):** Calls laufen über **headless Claude Code CLI** (`claude -p`, Secret `CLAUDE_CODE_OAUTH_TOKEN` aus `claude setup-token`) — Abrechnung übers Claude-Abo statt API-Key. **Triage:** `claude-haiku-4-5` ohne Tools. **Draft/Update:** `claude-sonnet-5`, WebSearch-Tool nur bei Eskalation (E28). Kein API-erzwungenes JSON-Schema mehr ⇒ strikte JSON-Prompts + 1 Repair-Versuch + Shape-Validierung in `claude.ts`. |
| 33 | Pipeline-Frontmatter | Generierte Artikel nutzen das **bestehende Schema unverändert** — kein `slug`-/`uncertainty`-/`aiDisclosure`-Freitextfeld (Regel 1!). Pflicht: `summary` ≥ 1, `sources` ≥ 1, `claims` mit `sourceIds`-Referenzen, `generationMode: ai_generated`, `editorialReview: none`. |
| 34 | Slugs | Semantisch mit zeitlichem Qualifier wo sinnvoll (`ams-arbeitslosigkeit-juli-2026`), Script prüft Kollision gegen bestehende Dateien (Suffix `-2`). Kein Datums-Präfix. |
| 35 | Fehlerverhalten | Feed-Fehler ⇒ source-health + weiter (Auto-Disable nach x Fails). Claude-Fehler ⇒ Error-Note + weiter. validate/build fail ⇒ Job fail **vor** jedem Push. Benachrichtigung: GitHub-Failure-Mail des Scheduled Workflows. |
| 36 | Claude-Systemprompt-Regeln | Hart im Prompt: keine erfundenen Quellen/URLs/Zitate/Zahlen; keine Primärquellen-Behauptung ohne gelesene Primärquelle; vorsichtige Sprache; sensible Themen konservativ (niedrige confidence, eher Research Note); im Zweifel Note statt Artikel. Verbotene Formulierungen aus CLAUDE.md Regel 2 gelten auch für generierte Texte. |
| 37 | Textlängen-Varianten | **Revidiert E18 teilweise:** Jeder Artikel-Body enthält zwei Textlängen in MDX-Wrappern: `<Kompakt>` (reiner Fließtext, 2–3 Absätze, ca. 100–180 Wörter, keine Überschriften, keine Fakten über den Standard-Body hinaus) und `<Standard>` (##-Sektionen wie bisher). Nichts außerhalb der Wrapper. Umschalter „Kompakt \| Standard" (Segmented Toggle, `TextlaengeToggle.astro`) über dem Body; Auswahl site-weit in `localStorage` (`nn-textlaenge`), Default und No-JS-Fallback: standard. Umschalter tauscht **nur** den Fließtext — Kurzfazit, Prüfband, Disclosure, Claims, Quellen bleiben immer sichtbar. Beide Varianten stehen im gebauten HTML (`html[data-textlaenge]`-CSS in `global.css`). Pipeline: Draft **und** Update liefern `bodyKompakt` mit; `validate.ts` erzwingt Wrapper + Kompakt-Regeln hart. |
| 38 | Relevanz-Ranking Startseite | Aufmacher + „Weitere Nachrichten" sortieren nach `relevanceScore` (`src/lib/articles.ts`): `quality = 0.4·newsworthiness + 0.15·confidence + 0.15·primarySourceStrength + 0.1·Quellenzahl(cap 5) + 0.1·Primär/Sekundär-Mix + 0.1·Belegt-Quote`, multipliziert mit Frische-Decay `0.5^(Alter_Tage/3)` auf Basis `lastUpdated` (Updates frischen auf). Neues Frontmatter-Feld `newsworthiness` (Integer 1–5, Default 3), vergeben von der Haiku-Triage; bei Story-Updates `max(bestehend, neu)` — nie herabstufen, Alterung übernimmt der Decay. „Neueste Artikel"-Grid, Themen-Seiten, RSS und „Weiterlesen" bleiben chronologisch. `score.ts`-Tuning: Event-/Kultur-PR-Penalty −0.15 (bewusst leichter als Sport/Promi −0.3; Trade-off: „eröffnung" trifft auch z. B. Verfahrenseröffnungen), KI/Digital/Cyber/Daten-Keywords eigener Tier +0.05 statt +0.10, Aussendung + genau 1 Medienportal −0.10 statt +0.10 (Bonus erst ab ≥2 Medienportalen). |
| 39 | Supabase-Scheduler | **Revidiert E25 teilweise:** GitHub-`schedule` driftet real 1–4 h (best-effort) ⇒ Scheduling via Supabase-Projekt `gmpxplyjbcabliuzhfne`: pg_cron (`7,37 * * * *`) → `net.http_post` → Edge Function `trigger-ai-news` (Auth `withSupabase({ auth: 'secret' })`, `@supabase/server`) → GitHub `workflow_dispatch`. URL + Secret-Key im Vault, GitHub-PAT als Function-Secret. Nach Verifikation `schedule:`-Trigger aus dem Workflow entfernen (Doppel-Läufe). Setup/Betrieb: [docs/supabase-scheduler.md](docs/supabase-scheduler.md). |
| 40 | Durchsatz-Paket | **Revidiert E28/E29 (2026-07-10):** (a) Max **3** Artikel/Run statt 1 (`AI_NEWS_MAX_ARTICLES_PER_RUN`), Triage-Cap 5→**8** Calls/Run, Web-Search-Deckel 8→**40**/Tag. (b) **Triage-Backlog** (`memory/triage-backlog.json`): Cluster über der Score-Schwelle, die wegen Triage-Cap, Artikel-Cap oder Triage-Fehler nicht behandelt wurden, kommen in den Backlog und werden im nächsten Run wieder in die Queue gemischt (Score-sortiert; Dedupe gegen aktuelle Kandidaten via URL-Überlappung oder Titel-Jaccard ≥ 0,5; Retention 48 h ab Erst-Einreihung; max 24 Einträge) — **kein hoch gescorter Cluster fällt still raus**. (c) **Volltext vor Triage** (`fulltext.ts`): bis zu 2 Artikel-URLs pro Triage-Kandidat (media-Quellen zuerst, max 1 pro Portal, 8 s Timeout, nur ≥ 300 Zeichen, Auszug max 3500 Zeichen) als `fulltextExcerpt` an Haiku — reine Beurteilungsgrundlage, nie Nachdruck, wird **nie persistiert** (research-JSONs und Backlog strippen das Feld — Urheberrecht). (d) **Web-Search-Eskalation:** `research_note` mit Cluster-Score ≥ 0,75 (`AI_NEWS_ESCALATE_SCORE`) oder newsworthiness ≥ 4 wird sofort mit erzwungener Web-Suche gedraftet (Primärquellen aktiv suchen) statt nur notiert; scheitert der Draft, bleibt die Note. (e) Fixes: Stories ohne `articlePath` (noted/monitor) werden regulär gedraftet statt „geupdatet" (sonst entstünden Cluster-ID-Slugs); Update ohne Artikeldatei auf main wird übersprungen. Manifest führt `articles[]`. *(Review-PR-Teil dieses Pakets 2026-07-11 mit E30 entfernt — alles publiziert direkt.)* |
| 41 | Metrik-Semantik & Begründungen | **Revidiert E15/E36 teilweise (2026-07-10):** (a) `confidence` ist **rein epistemisch** (Sicherheit der Darstellung nach Quellenlage); Sensibilität drosselt nicht mehr die Konfidenz, sondern nur Tonalität/Claim-Einstufung (`sensitivity` bleibt pipeline-intern). (b) **Bestätigtes Ereignis:** handelnde Institution verkündet eigenes Handeln (Aussendung/Dokument/Urteil) ⇒ bestätigt; APA-*Agenturmeldung* ⇒ bestätigt; sonst 2 unabhängige Quellen — n Portale mit derselben Agenturmeldung = 1 Quelle. (c) **OTS ≠ APA:** OTS ist ungeprüfter Verteilkanal; Gewicht = Gewicht des Absenders (Institution über eigenes Handeln ⇒ bestätigt; Behauptung über Dritte ⇒ eine Parteistimme ⇒ treibt framingRisk, nicht confidence). (d) **framingRisk-Rubrik:** gering = Gegenseite aus direkt eingesehener Quelle · mittel = eine Perspektive dominiert oder Gegenseite nur aus zweiter Hand · hoch = nur eine Seite. (e) **Pflicht-Begründungen** `confidenceNote`/`sourceStrengthNote`/`framingRiskNote` (je 1 Satz) im Frontmatter, Zod + validate.ts erzwingen, Anzeige aufklappbar im Prüfband. (f) UI-Label „Quellenstärke" → **„Primärquellen"** (Prüfband, Cards, Methodik). (g) Bestandsartikel werden nachgezogen (Notes ergänzt, Glattauer-Artikel `confidence` → `high`), ohne `corrections`-Eintrag (Metadaten-Pflege, keine inhaltliche Korrektur). Begriffs-Glossar: [CONTEXT.md](CONTEXT.md). |
| 42 | Startseiten-Struktur | **Revidiert E12 teilweise (2026-07-10):** Nach dem Relevanz-Top-Bereich (Aufmacher + „Weitere Nachrichten", E38) folgen **Ressort-Sektionen** je nicht-leerem Topic in `TOPICS`-Reihenfolge: verlinkte Ressort-Überschrift, bis zu 3 neueste Artikel (chronologisch), Link „Alle N Artikel →" auf die Themen-Seite. Duplikate mit dem Top-Bereich sind erlaubt (Top = Relevanz, Ressort = Chronologie), leere Ressorts entfallen ohne Platzhalter. Ersetzt das „Themenbereiche"-Zähler-Grid und das seitenweite „Neueste Artikel"-Grid; „Wie wir arbeiten"-Band wandert ans Seitenende. |
| 43 | Rechtsseiten | **Finalisiert (2026-07-10):** Medieninhaber = **Privatperson** Christoph Martin (bewusst ohne Gewerbe-Bezug ⇒ keine ECG-Unternehmer-Zusatzangaben), Kontakt `christophmartin@gmx.at`. Anschrift **„7503 Großpetersdorf" ohne Straße/Hausnummer** — bewusste Risiko-Entscheidung des Betreibers (§ 5 ECG/§ 25 MedienG verlangen formal ladungsfähige Anschrift; Beanstandungsrisiko bei nicht-kommerziellem Angebot als gering akzeptiert). Datenschutz: GitHub Pages/DPF-Abschnitt, localStorage-Hinweis (`nn-textlaenge`, `nn-consent`), Betroffenenrechte + DSB. AI-Act Art 50 Abs 4 (Deployer-Offenlegung) ist durch die strukturell erzwungene Disclosure-Box erfüllt; maschinenlesbare Kennzeichnung (IPTC `digitalSourceType` im JSON-LD) bewusst verschoben → Go-Live-TODOs. |
| 44 | Artikelbilder (Pressefotos) | **Neu (2026-07-10):** Optionales Hero-Bild pro Artikel (Hero = Teaser, max 1 Bild). **Einzige Bildquelle: offizielle Pressefoto-Angebote der im Artikel zitierten Institutionen** mit ausdrücklichem Nutzungsrecht (CC-Tag oder z. B. „honorarfrei für redaktionelle Nutzung"). Bewusst verworfen: Bilder aus Quell-Artikeln (fremde Agentur-Lizenzen, § 74 UrhG — Quellenangabe ersetzt keine Lizenz), Wikimedia/Commons-Suche, Stockfotos, KI-Bilder, Teaser-Karten-Fallback — kein sauberes Pressefoto ⇒ **kein Bild** (gemischtes Teaser-Layout akzeptiert). **Auswahl-Mechanik (revidiert am 2026-07-10, ersetzt Ad-hoc-LLM-Bildsuche):** Bilder kommen deterministisch aus der **kuratierten Whitelist** `data/ai-news/image-sources.yaml` — jeder Eintrag einmalig von einem Menschen geprüft (Terms gelesen, erlaubender Satz wörtlich als `termsQuote` gesichert); die Pipeline matcht nur Titel-Keywords/Quell-Domains/Topic (Reihenfolge = Priorität, Personen vor Institutionen) und lädt das hinterlegte Bild. Keine LLM-Bildsuche im Draft (Token-Kosten, Interpretationsrisiko unbeaufsichtigt in CI); neue Whitelist-Kandidaten werden manuell ergänzt. **Relevanz-Schwelle:** Bild nur bei Cluster-Score ≥ 0,85 (`AI_NEWS_IMAGE_MIN_SCORE`) — Bilder sind hochrelevanten Stories vorbehalten, darunter bleibt der Artikel bildlos. Beweissicherung Pflicht: `termsUrl` + wörtliches `termsQuote` + Abrufdatum. Aufnahme-Regeln für Whitelist-Einträge: nur offizielle Presse-Kanäle; ausdrückliche Erlaubnis nötig (Schweigen/„alle Rechte vorbehalten"/Agentur-Credits APA/Getty/Reuters/dpa ⇒ kein Eintrag); Einschränkungen der Terms als `topics`-Filter abbilden (z. B. Parlament nur politische Berichterstattung); vorgeschriebene Credit-Formulierung exakt übernehmen; keine Personenfotos bei Verbrechen/Opfern/Kindern (§ 78 UrhG); im Zweifel kein Bild. Verarbeitung: Download → Resize max 1600 px + WebP, **kein Crop auf Dateiebene** (Bearbeitungsverbote; feste Ratios nur via `object-fit: cover`; „keine Bearbeitung jeglicher Art" in Terms ⇒ kein Bild), Ablage `src/assets/articles/<slug>/`. **Hero-Eignungs-Guard (2026-07-10, nach Live-Befund):** Pipeline lehnt Hoch-/Quadratformat (Ratio < 1,2) und Quellen < 800 px Breite hart ab (Porträt-Pressefotos sind meist Hochformat und sprengen sonst die Seite); Hero rendert fix 16:9 via `object-fit: cover` als Layout-Guard, Teaser 3:2. Whitelist-Einträge müssen Querformat sein. Self-Hosting statt Hotlink (DSGVO, Link-Rot). Attribution: sichtbare Credit-Zeile unterm Hero (Urheber + Lizenz/Terms verlinkt) + auto-generierte Seite `/bildnachweis` (Footer-Link) für die Teaser-Nutzungen. Frontmatter `image` optional, `license` als Zod-Enum (CC0/PD/CC BY/CC BY-SA/press_permission) — Allowlist strukturell erzwungen. Bestand: einmaliger Backfill über die Bestandsartikel als **Kalibrierungs-PR** (Agent-Recherche mit menschlichem Review — lieferte zugleich die ersten Whitelist-Einträge). |
| 45 | News-Sitemap | **Neu (2026-07-10), ergänzt E8:** `@astrojs/sitemap` bleibt Generator, aber ein Post-Build-Hook (`scripts/sitemap-news.mjs`, als Astro-Integration nach `sitemap()` registriert) reichert `sitemap-*.xml` an — @astrojs/sitemap kann weder Google-News-Tags noch Artikel-Metadaten. Pro Artikel: `<lastmod>` (updatedAt ?? publishedAt), `<news:news>` nur für Artikel < 48 h (Google News liest 2 Tage; Publikation „Neue Nachrichten", Sprache de), `<image:image>` aus dem og:image der gebauten Seite (einzige Stelle mit finaler Asset-URL). Entfernt noindex-URLs aus der Sitemap (Impressum, Datenschutz, retracted/archived) — noindex + Sitemap wären widersprüchliche Signale. Frontmatter wird direkt via gray-matter gelesen (Content-API steht im Build-Hook nicht zur Verfügung). In GSC wird nur `sitemap-index.xml` eingereicht. |
| 46 | Resonanz (Medienecho-Ranking) | **Neu (2026-07-11), ergänzt E38:** News entwickeln sich — Stories, die nach Publikation Wellen schlagen, sollen den Aufmacher erreichen können, ohne dass ein inhaltliches Update nötig ist. Neues Konzept **Resonanz** (Glossar: [CONTEXT.md](CONTEXT.md)): beobachtetes Medienecho, getrennt vom Nachrichtenwert (`newsworthiness` bleibt unangetastet, `updatedAt` bleibt an Korrekturen gekoppelt). **Frontmatter:** optionales `resonance: { level: 2–5, measuredAt, source: zaehlung\|triage }` — Level 1 = neutral, wird nie geschrieben. **Messung (Pipeline, jeder Run, vor der Draft-Phase):** deterministisch distinkte Publisher (`portalOf`, ORF-Feeds kollabieren) mit neuen Items, die auf eine Story mit publiziertem Artikel matchen, rollierendes 24-h-Fenster im Story-Memory (`echoPublishers`); Mapping 0–1→1 · 2→2 · 3→3 · 4→4 · **≥5→5**. **Haiku-Override:** Triage beurteilt bei gematchter Story zusätzlich Echo-Qualität (`resonance` 1–5; Agentur-Syndikation = mehrere Portale mit demselben Agenturtext zählt als 1, E41b) und ersetzt die Zählung in beide Richtungen; Override-TTL = 24 h (= Messfenster — Syndikations-Items fallen zeitgleich aus dem Fenster). Deterministisches Level ≥ 4 priorisiert den Cluster in die Triage-Queue. **Ranking:** additiver Term in `relevanceScore`: `+ 0.35 · (level−1)/4 · 0.5^(Alter_Tage/1)` (Halbwertszeit 1 Tag — Welle ebbt von selbst ab; Gewicht an echten Scores kalibriert: ursprünglich angesetzte 0,25 überbrückten den Quality-Abstand eines News-3-Artikels mit schwacher Quellenlage zu einem gleichtägigen News-5-Aufmacher (~0,33) nicht). Bewusst akzeptiert: eine Welle kann Artikel mit schwacher Quellenlage zum Aufmacher machen — Metriken stehen sichtbar daneben. **Schreiben mit Hysterese:** nur bei Level-Änderung oder wenn `measuredAt` älter als 12 h (kein Commit-Rauschen alle 30 min); Resonanz-only-Runs setzen Manifest-Action `resonance_update` und dispatchen deploy.yml. **Täglicher Fallback-Rebuild** via Supabase pg_cron (`trigger-daily-site-rebuild` → Edge Function → deploy.yml-Dispatch), damit der Decay auch ohne Content-Pushes sichtbar wird. **UI:** Badge „Breites Echo" ab Level 4 mit Messung < 48 h (Aufmacher + Top-Liste), Methodik-Abschnitt erklärt Messung und Ranking-Einfluss. Ressorts/Themen/RSS bleiben chronologisch. |
| 47 | Cluster-Matching & Chronik-Scoring | **Neu (2026-07-11), revidiert E29/E40 im Detail — Wielandpark-Lehre:** Der Messerangriff Wien-Favoriten (wien.orf.at/3362111) lief über 4 Portale + OTS ein, zerfiel aber wegen Schlagzeilen-Varianten („Zwölfjähriger"/„12-Jähriger", „verletzt"/„verletzte") in 4 Einzel-Cluster, die alle unter der Triage-Schwelle blieben — die Story wurde nie triaged. Fixes in `util.ts`/`score.ts`: (a) `normalizeTitle` ersetzt Zahlwörter zwei–zwölf durch Ziffern (inkl. „…jährig"-Komposita, Lookarounds statt ASCII-`\b`), `titleTokens` stemmt Flexionssuffixe (-ern/-em/-en/-er/-es/-e/-n/-s, Mindest-Stammlänge 4); reine Zahl-Tokens bleiben ausgeschlossen (Beträge/Prozente erzeugen sonst False-Merges). (b) Neue **Chronik-Keyword-Gruppe** (+0,1, bewusst eng: polizei, festnahme, ermittlungen, tatverdächtig, messerangriff/-attacke/-stich, lebensgefährlich, schwer verletzt, amoklauf, brandstiftung, wega); Sport/Promi/Event-Penalties bleiben unberührt. (c) Triage-Schwelle **inklusiv** (`>= 0,65` statt `>`). Replay-Verifikation: die 4 Fragmente bilden jetzt 1 Cluster mit Score 0,95 (3 Portale + Chronik + frisch). Bewusst akzeptiert: ~1,6 % weniger Cluster über den 30-Tage-Bestand, vereinzelte Merges thematisch ähnlicher Kleinmeldungen (z. B. Regional-Unfälle) — solche Cluster scoren niedrig bzw. die Triage sieht alle Titel und entscheidet. |
| 49 | Commons-Bildsuche (automatisch) | **Neu (2026-07-12), revidiert E44:** E44 hatte Wikimedia/Commons + automatische Bildsuche verworfen (Token-Kosten + Interpretationsrisiko unbeaufsichtigt in CI + Rechtsrisiko). Betreiber-Entscheidung: automatische Commons-Suche als **Fallback nach der kuratierten Whitelist** freischalten, um die geringe Bild-Coverage zu heben (`scripts/ai-news/commons.ts`, `selectCommonsImage`). **Token-/Interpretations-Einwand entfällt:** Auswahl ist **rein deterministisch** — MediaWiki-API (`generator=search`, namespace File), Sortierung nach Such-`index`, erster Kandidat der alle Guards besteht; **kein LLM-Turn, keine Tokens.** **Rechtsrisiko bleibt und wird bewusst akzeptiert** (wie E43): Commons ist User-Upload — Lizenz-Tags nicht garantiert korrekt (Copyfraud → Nutzer haftet), CC deckt keine Persönlichkeitsrechte (§ 78 UrhG). **Guards (mildern, eliminieren nicht):** nur Lizenzen aus der Allowlist via `commonsLicenseToAllowlist` (CC0/PD/CC BY/CC BY-SA, Country-Varianten gemappt; ND/GFDL-only/unbekannt ⇒ abgelehnt) · extmetadata `Restrictions` muss leer sein (Marken-/Personenrechte-/Sonderauflagen-Flag) · `AGENCY_MARKERS` im Urheber ⇒ abgelehnt · Querformat ≥ 800 px, Ratio ≥ 1,2, nur JPEG/PNG/WebP · **Sensitivity-/Framing-Gate in `run.ts`: kein Commons-Bild bei `sensitivity: high` oder `framingRisk: high`** (Verbrechen/Opfer/Kinder — § 78) · `kind` **immer** `symbol` (Layout hängt „(Symbolbild)" an — nie als Ereignisfoto ausgegeben) · Abschluss durch dasselbe `sanitizeDraftImage` wie Whitelist/Backfill (termsQuote ≥ 15, https-Pflicht). `termsQuote` = wahrheitsgemäße Herkunftsangabe („Lizenzangabe ‚…' laut Dateibeschreibungsseite auf Wikimedia Commons"), eigentlicher Beleg = `credit.sourceUrl` (Dateiseite). Score-Gate (`AI_NEWS_IMAGE_MIN_SCORE` ≥ 0,85) gilt unverändert; Kill-Switch `AI_NEWS_COMMONS=0`. Whitelist bleibt Priorität 1 (Pressefoto der zitierten Institution schlägt Symbolbild). **Greift nur bei neuen + reaktivierten Stories** (gleiche Bedingung wie Whitelist: `!imageFrontmatter && allowImage`) — Altbestand ohne Bild wird NICHT automatisch nachgezogen (dafür separater Sweep/Backfill nötig). |
| 48 | Bild-Kandidaten-Scan & Tech-Whitelist | **Neu (2026-07-11), ergänzt E44:** (a) **Proposal-only-Quellen-Scan** (`scripts/ai-news/image-scan.ts`): Für jeden neuen Draft ohne Whitelist-Bild scannt die Pipeline die zitierten Quell-Seiten (og:image/twitter:image/JSON-LD/`<figure>`-Bilder + Credit-Text in Bildnähe, max 4 Seiten/Artikel, nur HTML — nie Bilddateien) und schreibt Kandidaten klassifiziert — `blocked` (Agentur-/Stock-Kennung; AGENCY_MARKERS + STOCK_MARKERS — z. B. das Shutterstock-Foto eines heise-Artikels: dessen Lizenz gilt nur heise) · `unknown` · `possibly-open` (CC-Hinweis, Pressekit-/Newsroom-Indiz) — ins committete, rollierende Register `data/ai-news/image-candidates.json` (Retention 30 Tage; Prune, sobald der Artikel ein Bild hat oder gelöscht ist) sowie als Tabelle ins GITHUB_STEP_SUMMARY. **Kein Kandidat wird je automatisch übernommen** — E44 gilt vollständig weiter: Bilder ausschließlich aus der kuratierten Whitelist, `sanitizeDraftImage` unverändert, „keine Bilder aus Quell-Artikeln"; die Klassifikation ist Triage-Hinweis, nie Rechtsprüfung. Scan bewusst ohne Score-Gate (er attached nichts; das Gate würde das Register aushungern), Kill-Switch `AI_NEWS_IMAGE_SCAN=0`, Fehler (Paywall, Bot-Block, Timeout) degradieren still — nie Abbruch des Artikel-Runs. (b) **Whitelist-Erweiterung Tech/KI:** Newsroom-/Pressebild-Angebote der großen KI-Akteure einzeln nach E44-Checkliste vetten — nur Einträge mit ausdrücklicher redaktioneller Drittnutzungs-Freigabe (wörtliches `termsQuote`); Anbieter ohne Freigabe bleiben draußen (erwartet und akzeptiert: mehrere Flagship-Namen qualifizieren nicht — dokumentierter Skip ist ein valides Ergebnis). Keyword-Matching in `selectWhitelistImage` auf Unicode-Wortgrenzen umgestellt („Meta" ≠ „Metadaten"). Bestands-Backfill über `backfill-proposals-from-whitelist.ts` → `backfill-images.ts`; das Score-Gate gilt dort bewusst nicht (menschliches Review ersetzt es). |
| 50 | Ressorts Sport + Kultur | **Neu (2026-07-13):** Zwei zusätzliche Topics ergänzt, angehängt in dieser Reihenfolge (`…wissenschaft, sport, kultur`). **Kultur statt Musik:** „Musik" allein wäre zu eng neben den breiten Bestands-Ressorts — „Kultur" (Musik, Film, Theater, Kunst, Literatur, Kulturbetrieb) hält die Breite konsistent und absorbiert Musik. Grenzregeln im Prompt (`claude.ts`) + Glossar ([CONTEXT.md](CONTEXT.md)): Sport = Sport als Gegenstand, aber Unglück/Kriminalität/Politik dominiert → altes Ressort (tödlicher Rennunfall bleibt „gesellschaft"); Kultur = reines Kulturereignis/-betrieb, Debatte drumherum bleibt „gesellschaft", Medienethik-Verfahren bleibt „gesellschaft". Enum an allen 6 Stellen erweitert (content.config.ts, articles.ts TOPICS+LABELS, types.ts, claude.ts Prompt-Schema+Zuordnungsregeln+Validierungs-Set); `/themen/*` + validate.ts sind topic-getrieben und ziehen automatisch mit. **Bestand umgetaggt → kultur:** Holzinger-Bodensee-Performance, Sandbichler-KHM-Kündigung (klare Kulturbetriebs-Fälle); Presserat-Falter und Jan-Völker-Interview bleiben „gesellschaft". **Zwei bewusst verschobene Restpunkte (Go-Live-TODOs):** (a) Ressort-Symbolbild-Fallback (`commons.ts` RESSORT_QUERIES) bewusst NICHT für Sport/Kultur gesetzt — Subgenres zu divers (Beachvolleyball≠Fußballstadion, Techno≠Theaterbühne), Event-Match trägt, sonst Text-Teaser; genauere Bildlogik folgt separat. (b) Scoring (`score.ts`) unangetastet: `LOW_VALUE_KEYWORDS` (−0,3, u. a. fußball/ski/tennis/olympia/match) und `EVENT_PR_KEYWORDS` (−0,15, konzert/festival/premiere) unterdrücken Sport/Kultur weiter. **Revidiert (2026-07-13, nach Verifikationslauf mit 0 Sport/Kultur):** neues additives `MAJOR_EVENT_KEYWORDS` (+0,2; Championship-/Titel-/Weltrekord-Ebene: weltmeister\*, europameister\*, weltcup, weltrekord\*, olympi\*, medaille\*, meistertitel, grand slam + große Kulturpreise/Flaggschiff-Festivals: nobelpreis\*, welturaufführung, berlinale, viennale, oscar(s), grammy(s), salzburger/bregenzer festspiele, goldene(r) löwe/palme). Malus bleibt bewusst bestehen — der Bonus reißt die Triage-Schwelle erst ZUSAMMEN mit ≥2 Portalen + Frische; Routine ohne diese Deckung bleibt draußen. Replay-Kalibrierung: WM-Finale/Festspiele/Nobelpreis (breit+frisch) → ai_triage 0,70–0,85; Routine-Ligaspiel selbst über 3 Portale → nur 0,50 (monitor); Einzelkonzert/Einzelspiel 1 Portal → ignore. |

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
newsworthiness: 1..5         # Triage-Nachrichtenwert (E38), Default 3
resonance:                   # optional — beobachtetes Medienecho (E46); Level 1 wird nie geschrieben
  level: 2..5
  measuredAt: datetime       # Messzeitpunkt (eigener Decay im Ranking, Halbwertszeit 1 Tag)
  source: zaehlung | triage  # deterministische Publisher-Zählung vs. Haiku-Urteil (TTL 24 h)
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
image:                       # optional — fehlt = Text-Teaser wie bisher (E44)
  file: image()              # Pfad relativ zur Artikeldatei (../../assets/articles/<slug>/hero.webp)
  alt: string
  caption: string
  kind: symbol | direct      # Symbolbild vs. Ereignisfoto; Default symbol
  credit:
    author: string           # ggf. exakt die vorgeschriebene Credit-Formulierung
    license: enum            # Allowlist in src/config/images.ts (CC0/PD/CC BY/CC BY-SA/press_permission);
                             # Lizenz-URL wird deterministisch abgeleitet, nie vom Modell übernommen
    sourceUrl: url           # Fundstelle des Bildes (Detailseite)
    termsUrl: url            # Nutzungsbedingungen (Nachweis)
    termsQuote: string       # wörtliches Zitat des erlaubenden Satzes
    retrievedAt: date        # Abrufdatum
```

Slug = Dateiname.

## Cross-Checks (`scripts/validate.ts`)

- jeder Artikel ≥ 1 Quelle
- jede `claim.sourceIds`-Referenz existiert
- `published`/`corrected` ⇒ `publishedAt` gesetzt
- `corrected` ⇔ ≥ 1 `corrections`-Eintrag mit `type: correction`
- `retracted` ⇒ `retractionReason` gesetzt
- `updatedAt` konsistent mit jüngstem `corrections`-Datum
- `newsworthiness` (falls gesetzt) ganze Zahl 1–5
- `resonance` (falls gesetzt): Level ganze Zahl 2–5, `measuredAt` ≥ `publishedAt` und nicht in der Zukunft, `source` ∈ {zaehlung, triage}
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

## AI-News-Pipeline (Entscheidungen 25–36, 39–40)

Ablauf pro Run (alle 30 min): RSS-Fetch (nur `enabled`-Feeds, 10 s Timeout, max 50 Items/Feed, URL-Normalisierung,
ID = sha256(sourceId+normalizedUrl)) → Dedupe gegen seen-items → Clustering (Token-Overlap, 48 h-Fenster)
→ regelbasiertes Scoring → Triage-Queue (aktuelle Kandidaten + Backlog, E40) → Volltext-Abruf →
Haiku-Triage (max 8) → max 3 Sonnet-Drafts/Updates → validate + build → Commit/Push main
(alle Artikel, auch sensitivity high — E30 revidiert 2026-07-11) → Memory-Update inkl. Backlog-Requeue.

```
.github/workflows/ai-news-research.yml
scripts/ai-news/{fetch-rss,cluster,score,triage,draft,run}.ts
data/ai-news/
  sources.yaml                 # Feed-Registry (E26)
  memory/                      # auf main committet (E27)
    seen-items.json  story-memory.json  source-health.json  run-history.jsonl  triage-backlog.json
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

- [x] Domain `neuenachrichten.at` live (2026-07-10): registriert via helloly, 4× A-Record auf GitHub-Pages-IPs + CNAME `www` → `cmaart.github.io`, Custom Domain in Pages gesetzt, Zertifikat ausgestellt, `https_enforced` aktiv; robots.txt-Sitemap-URL passte bereits
- [x] GitHub Pages aktivieren (Source: GitHub Actions) — passiert automatisch beim ersten Workflow-Lauf (`configure-pages` mit `enablement: true`)
- [ ] Feedback-Link „Fehler oder fehlende Quelle melden": GitHub-Issue-Template (`korrektur.yml`, vorausgefüllt mit Slug) + Link-Komponente einbauen
- [ ] Newsletter: Anbieter wählen, Block reaktivieren
- [ ] **GA4 erst bei fixer Domain aktivieren**: Measurement-ID (`G-…`, nicht Property-ID) als
  Repo-Variable `PUBLIC_GA_ID` setzen — Code (Consent Mode v2 + Cookie-Banner) ist fertig und
  ohne Variable deaktiviert. Property 544960890 existiert bereits.
- [x] Impressum mit echten Daten (E43, 2026-07-10 — Privatperson, Anschrift bewusst ohne Straße)
- [x] Datenschutzerklärung finalisiert (E43, 2026-07-10 — Hosting/DPF, localStorage, Betroffenenrechte, DSB)
- [ ] Bei GA4-Einbau: GA4-Abschnitt in `datenschutz.astro` an `hasGa` koppeln (inaktiv ⇒ nur „derzeit keine Webanalyse aktiv") + „Stand"-Datum aktualisieren
- [ ] SEO/GEO/AEO: KI-Kennzeichnung maschinenlesbar — IPTC `digitalSourceType` (`trainedAlgorithmicMedia`) ins Artikel-JSON-LD (`src/pages/artikel/[...slug].astro`), Wert ggf. aus `generationMode` ableiten
- [x] Demo-Artikel entfernen/ersetzen
- [x] Echte Recherche-Pipeline (Scripts/GitHub Actions) — Design fixiert in Entscheidungen 25–36, implementiert und live
- [x] Supabase-Scheduler scharf geschaltet (E39, 2026-07-10): deployed, E2E verifiziert, `schedule:`-Trigger entfernt — Betrieb/Restpunkt (1 Tag beobachten) in [docs/supabase-scheduler.md](docs/supabase-scheduler.md)
- [ ] **Ressort Sport/Kultur — Bild-Fallback (E50):** genauere Symbolbild-Logik für Sport/Kultur bauen (Subgenre-bewusst: Sportart/Musikrichtung → passende Query) statt generischem Ressort-Fallback; aktuell nur Event-Match, sonst Text-Teaser
- [x] **Ressort Sport/Kultur — Scoring geöffnet (E50, 2026-07-13):** additives `MAJOR_EVENT_KEYWORDS` (+0,2) in `score.ts` — große Sport/Kultur-Events reißen die Triage-Schwelle nur zusammen mit ≥2 Portalen + Frische, Routine/Boulevard bleibt unter der Schwelle (Replay-verifiziert). Offener Beobachtungspunkt: reale Sport/Kultur-Cluster im nächsten Run prüfen und Keyword-Liste bei Bedarf nachschärfen
- [ ] Optional: Über-uns-Seite, Dark Mode, cookielose Analytics-Alternative evaluieren
