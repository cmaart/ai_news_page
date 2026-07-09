# Neue Nachrichten

Nachrichten-Website auf Basis KI-gestützter Recherche — mit offener Quellenlage, automatisiert erstellt, nicht zwingend redaktionell geprüft.

Statische Website (Astro), gehostet auf GitHub Pages. Geplante Domain: `neuenachrichten.at`.
Entscheidungslog und Architektur: [PLAN.md](PLAN.md) · Design-Referenz: [docs/design-tokens.md](docs/design-tokens.md)

## Tech-Stack

- **Astro 7** (Static Site Generator, Content Collections mit Zod-Schema)
- **MDX** — ein Artikel = eine Datei, alle Metadaten im Frontmatter
- **Vanilla CSS** mit Custom Properties (Design-Tokens), keine CSS-Frameworks
- **Self-hosted Fonts** via `@fontsource` (Spectral, IBM Plex Sans, IBM Plex Mono)
- **GitHub Actions** für Validation, Build und Deploy
- **GA4 mit echtem Opt-in** (Consent Mode v2, lädt nur nach Einwilligung; ohne `PUBLIC_GA_ID` komplett deaktiviert)
- Keine Datenbank, kein CMS, keine Server-Komponente, keine Auth

## Setup

Voraussetzung: Node.js ≥ 22.12 (LTS empfohlen).

```bash
npm install
npm run dev        # Dev-Server auf http://localhost:4321
```

## Befehle

| Befehl | Zweck |
|--------|-------|
| `npm run dev` | Dev-Server mit Hot Reload |
| `npm run build` | Produktions-Build nach `dist/` (validiert das Frontmatter-Schema via Zod) |
| `npm run preview` | Gebauten Stand lokal ansehen |
| `npm run validate` | Content-Cross-Checks (Quellen-Referenzen, Status-Konsistenz, …) |

## Deployment (GitHub Pages)

Ein Workflow: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)

- **Pull Request** → `npm run validate` + `npm run build` (kein Deploy)
- **Push auf `main`/`master`** → validate + build + Deploy auf GitHub Pages

Einmalig nötig (siehe Go-Live-TODOs in PLAN.md): Repo-Settings → Pages → Source „GitHub Actions"; Domain/DNS;
Repository-Variable `PUBLIC_GA_ID` für Analytics.

## Content-Workflow

1. Neue MDX-Datei unter `src/content/articles/` anlegen — **der Dateiname ist der Slug** (`mein-artikel.mdx` → `/artikel/mein-artikel/`).
2. Frontmatter vollständig ausfüllen (Schema unten). Body = freier Fließtext mit `##`-Überschriften (kein `#`).
3. `npm run validate && npm run build` lokal prüfen.
4. Per Pull Request einbringen — der PR ist der Review-/Audit-Trail, CI validiert automatisch.

### Frontmatter-Felder

```yaml
title: string                # Titel
description: string          # Standfirst / Teaser
publishedAt: 2026-07-02      # Pflicht ab Status published
updatedAt: 2026-07-09        # nur bei Korrekturen/Updates — muss dem jüngsten corrections-Datum entsprechen
topic: politik | wirtschaft | gesellschaft | technologie | wissenschaft
country: at | de | eu | int
status: draft | review | published | corrected | retracted | archived
generationMode: ai_generated | ai_assisted | manually_reviewed
editorialReview: none | basic | full
confidence: low | medium | high            # Wie sicher ist die Gesamtdarstellung
primarySourceStrength: none | weak | medium | strong   # Belastbarkeit der Primärquellen
framingRisk: low | medium | high           # Risiko gefärbter Darstellung in den Quellen
summary:                     # Kurzfazit-Bullets
  - text: '…'
    kind: fact               # fact = ✓ (belegt), open = ? (offen)
openQuestions:               # Sektion „Was noch unklar ist"
  - '…'
sources:                     # mindestens eine
  - id: src1                 # eindeutig im Artikel; Claims referenzieren diese IDs
    name: '…'
    type: agency | media | primary | official | study | press_release | other
    url: 'https://…'
claims:                      # geprüfte Aussagen
  - id: claim1
    text: '…'
    status: supported | partial | unclear | contradicted
    note: '…'                # optional: Einordnung
    sourceIds: [src1, src2]
corrections:                 # Korrektur-/Update-Historie
  - date: 2026-07-09
    type: correction | update
    text: '…'
retractionReason: '…'        # Pflicht bei status: retracted
aiDisclosureNote: '…'        # optional: Ergänzung zur automatischen Disclosure
```

### Bedeutung der Statusfelder

- **`status`** steuert die Sichtbarkeit:
  - `draft`, `review` — werden **nicht gebaut**, tauchen nirgends auf
  - `published` — überall gelistet (Startseite, Themen, RSS, Weiterlesen)
  - `corrected` — wie `published`, zusätzlich Badge „Korrigiert" + Korrektur-Timeline
  - `retracted` — nur per Direkt-URL und auf `/korrekturen/` erreichbar, mit Retraction-Banner, `noindex`
  - `archived` — nur per Direkt-URL erreichbar, Badge „Archiviert", `noindex`
- **`generationMode`** — wie der Artikel entstand: `ai_generated` (vollautomatisch), `ai_assisted` (KI-gestützt mit
  menschlicher Steuerung), `manually_reviewed` (nachträglich menschlich geprüft). Wird immer sichtbar angezeigt.
- **`editorialReview`** — Grad menschlicher Prüfung: `none` (Standard, wird deutlich als „Nicht redaktionell
  geprüft" angezeigt), `basic`, `full`.

Die KI-Disclosure-Box wird **strukturell erzwungen**: Das Artikel-Layout rendert sie immer, der Text wird aus
`generationMode` + `editorialReview` abgeleitet ([src/config/disclosure.ts](src/config/disclosure.ts)).
Sie kann per Frontmatter weder weggelassen noch überschrieben werden.

### Artikel korrigieren

1. Inhalt/Frontmatter berichtigen (z. B. Zahl im Body und betroffene Claims).
2. `corrections`-Eintrag mit `type: correction`, Datum und Beschreibung anhängen — **was** war falsch, **was** ist jetzt richtig.
3. `status: corrected` setzen, `updatedAt` auf das Datum des neuen Eintrags.
4. `npm run validate` — prüft die Konsistenz dieser drei Schritte.

Kleinere Ergänzungen ohne Fehlerkorrektur: `corrections`-Eintrag mit `type: update` — der Status bleibt
`published`, `updatedAt` muss trotzdem gesetzt werden. Sobald mindestens ein Eintrag `type: correction` hat,
muss der Status `corrected` sein.

### Artikel zurückziehen

1. `status: retracted` setzen.
2. `retractionReason` ausfüllen (wird prominent im Banner angezeigt).
3. Artikel bleibt per URL erreichbar (Transparenz), verschwindet aus allen Listen und wird auf `/korrekturen/` geführt.

### Quellen ergänzen

Neuen Eintrag in `sources` mit eindeutiger `id` anlegen. Typen `primary`, `official`, `study`, `press_release`
werden als **Primärquellen** gruppiert, `media`, `agency`, `other` als Sekundärquellen. Claims über `sourceIds`
auf die neue Quelle verweisen lassen.

## Validierung

Zwei Ebenen:

1. **Zod-Schema** ([src/content.config.ts](src/content.config.ts)) — Felder, Enums, URL-Format. Läuft bei jedem Build.
2. **Cross-Checks** ([scripts/validate.ts](scripts/validate.ts)) — Konsistenz zwischen Feldern:
   - jeder Artikel hat ≥ 1 Quelle, Quellen-IDs eindeutig
   - jede `claim.sourceIds`-Referenz existiert
   - `published`/`corrected` ⇒ `publishedAt` gesetzt
   - `corrected` ⇔ mindestens ein `corrections`-Eintrag mit `type: correction`
   - `retracted` ⇒ `retractionReason` gesetzt
   - `updatedAt` entspricht dem jüngsten `corrections`-Datum
   - eindeutige Slugs

## Wichtige Dateien

```
PLAN.md                          Entscheidungslog, Schema, Go-Live-TODOs
docs/design-tokens.md            Extrahierte Design-Werte der Vorlage
src/content.config.ts            Zod-Schema der Artikel
src/config/disclosure.ts         Zentrale KI-Disclosure-Texte
src/content/articles/*.mdx       Artikel (Demo-Inhalte, vor Go-Live ersetzen)
src/lib/articles.ts              Labels, Sichtbarkeitsregeln, Helpers
src/layouts/BaseLayout.astro     Header, Footer, Meta/OG, Cookie-Banner
src/components/                  Prüfband, DisclosureBox, ClaimList, SourceList, …
src/pages/                       Routen (deutsch: /artikel/, /themen/, /methodik/, …)
scripts/validate.ts              Content-Cross-Checks
.github/workflows/deploy.yml     CI: PR = validate+build · main = +Deploy
```
