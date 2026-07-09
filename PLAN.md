# Neue Nachrichten — Plan & Entscheidungslog

Statische, KI-gestützte Recherche-/News-Website. Astro + GitHub Pages. Domain (geplant): `neuenachrichten.at`.
Ergebnis der Grilling-Session vom 2026-07-09.

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
5. **MDX-Body** (freie `##`-Sektionen)
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

## Go-Live-TODOs

- [ ] Domain `neuenachrichten.at` kaufen; DNS: A-Records auf GitHub-Pages-IPs + CNAME `www`; Custom Domain in Repo-Settings → Pages eintragen (`site`/`base` stellen sich dann automatisch um); `public/robots.txt` Sitemap-URL prüfen
- [x] GitHub Pages aktivieren (Source: GitHub Actions) — passiert automatisch beim ersten Workflow-Lauf (`configure-pages` mit `enablement: true`)
- [ ] Feedback-Link „Fehler oder fehlende Quelle melden": GitHub-Issue-Template (`korrektur.yml`, vorausgefüllt mit Slug) + Link-Komponente einbauen
- [ ] Newsletter: Anbieter wählen, Block reaktivieren
- [ ] **GA4-Property anlegen, Measurement-ID als `PUBLIC_GA_ID` setzen**
- [ ] Impressum mit echten Daten (§ 5 ECG, Offenlegung § 25 MedienG — Name/Anschrift Pflicht)
- [ ] Datenschutzerklärung finalisieren (GA4-Abschnitt, GitHub Pages als Hoster, Widerrufsweg)
- [ ] Demo-Artikel entfernen/ersetzen
- [ ] Echte Recherche-Pipeline (Scripts/GitHub Actions, erzeugt MDX via PR) — separates Projekt
- [ ] Optional: Über-uns-Seite, Dark Mode, cookielose Analytics-Alternative evaluieren
