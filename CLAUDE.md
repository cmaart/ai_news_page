# CLAUDE.md

„Neue Nachrichten" — statische News-Website auf Basis KI-gestützter Recherche mit offener Quellenlage.
Astro 7 · MDX · Vanilla CSS · GitHub Pages. Sprache der Site und aller Inhalte: Deutsch (de-AT).

**Vor Änderungen [PLAN.md](PLAN.md) lesen** — dort stehen alle 38 Architektur-Entscheidungen, das
Frontmatter-Schema und die Go-Live-TODOs. Design-Werte der Vorlagen: [docs/design-tokens.md](docs/design-tokens.md).

## Befehle

```bash
npm run dev        # Dev-Server (localhost:4321)
npm run build      # Produktions-Build → dist/ (validiert Zod-Schema)
npm run preview    # Gebauten Stand ansehen
npm run validate   # Content-Cross-Checks (vor jedem Commit mit Artikel-Änderungen)
```

Deploy: Push auf `main` → GitHub Actions baut und deployt auf GitHub Pages
(live: https://neuenachrichten.at/). PRs werden nur validiert+gebaut.

## Unverhandelbare Regeln

1. **KI-Disclosure ist strukturell erzwungen.** Das Artikel-Layout rendert die Disclosure-Box immer;
   Texte kommen zentral aus [src/config/disclosure.ts](src/config/disclosure.ts), abgeleitet aus
   `generationMode` + `editorialReview`. Nie in ein Frontmatter-Freitextfeld umwandeln, nie optional machen.
2. **Verbotene Formulierungen** (außer explizit per Status gesetzt): „redaktionell geprüft", „faktengeprüft",
   „journalistisch verifiziert", „garantiert objektiv", „unabhängige Redaktion", „wahr". Stattdessen:
   „Quellenlage", „laut vorliegenden Quellen", „nicht abschließend verifiziert", „KI-gestützt erstellt".
   Gilt für UI-Copy, Meta-Texte, README — überall.
3. **Interne Links immer über `withBase()`** aus [src/lib/url.ts](src/lib/url.ts) — nie `href="/..."`
   hardcoden. Grund: GitHub Pages ohne Custom Domain liegt unter `/ai_news_page/`; `site`/`base` kommen
   im CI von `actions/configure-pages` (Env `SITE_URL`/`BASE_PATH`).
4. **Design-Vorlagen sind nur visuell bindend** (Fonts, Farben, Abstände exakt), niemals inhaltlich:
   Die BELEG-Vorlagen behaupten menschliche Redaktion — solche Texte nie übernehmen. Abweichungen von
   den Vorlagen sind in design-tokens.md dokumentiert (u. a. max 1024px statt 1080/1140px).
5. **Positionierung:** Produkt ist eine News-Seite („Nachrichten", „Artikel") — KI-Recherche ist die
   Methode, nicht der Produktname. Nicht „Recherchen" als Produktbegriff verwenden.
6. **Immer aktuellste stable Versionen.** Bei neuen Dependencies `npm view <pkg> version` prüfen,
   nicht aus dem Gedächtnis pinnen; bei Major-Sprüngen Upgrade-Guide lesen.

## Architektur-Kurzüberblick

- **Ein Artikel = eine MDX-Datei** in `src/content/articles/`, Dateiname = Slug. Alle strukturierten
  Daten (Quellen, Claims, Korrekturen, Metriken) im Frontmatter; Body nur Fließtext mit `##` (kein `#`).
- **Zwei Textlängen pro Body** (PLAN.md E37): `<Kompakt>` (reiner Fließtext, 2–3 Absätze, keine
  Überschriften) + `<Standard>` (`##`-Sektionen), nichts außerhalb der Wrapper — validate.ts erzwingt das.
  Umschalter `TextlaengeToggle.astro`, Auswahl in `localStorage` (`nn-textlaenge`), Default standard.
- **Zod-Schema:** [src/content.config.ts](src/content.config.ts) (Zod 4: `z.url()`, nicht `z.string().url()`).
- **Cross-Checks:** [scripts/validate.ts](scripts/validate.ts) — Quellen-Referenzen, Status-Konsistenz
  (`corrected` ⇔ Korrektur-Eintrag, `retracted` ⇒ `retractionReason`, `updatedAt` = jüngstes Korrektur-Datum).
- **Sichtbarkeit nach `status`:** `draft`/`review` nie gebaut · `published`/`corrected` überall gelistet ·
  `retracted` nur Direkt-URL + `/korrekturen/` mit Banner + noindex · `archived` nur Direkt-URL + noindex.
  Logik zentral in [src/lib/articles.ts](src/lib/articles.ts) (`isListed`/`isBuilt`) — nirgends duplizieren.
- **Labels/Mappings** (Topics, Länder, Claim-Status, Meter-Füllstände): ebenfalls `src/lib/articles.ts`.
- **GA4:** nur mit Env `PUBLIC_GA_ID`, echtes Opt-in (Consent Mode v2, Default denied), Banner in
  `CookieBanner.astro`. Ohne Env komplett deaktiviert — lokal ist das der Normalzustand.
- **Styling:** Design-Tokens in `src/styles/global.css`, komponenten-scoped Styles in den `.astro`-Dateien.
  Kein Tailwind, keine CSS-Frameworks. Fonts self-hosted via `@fontsource` (DSGVO — kein Google-CDN).
- **Pipeline-Scheduling via Supabase** (PLAN.md E39): pg_cron → Edge Function `trigger-ai-news` →
  GitHub `workflow_dispatch` (GitHub-`schedule` driftet 1–4 h). Struktur unter `supabase/`
  (Migrationen + Functions), CLI als devDependency (`npx supabase …`), Setup/Betrieb:
  [docs/supabase-scheduler.md](docs/supabase-scheduler.md).

## Bekannte Stolpersteine

- **Dev-Server-HMR wird nach vielen Edits an einer Seite stale** (Styles im HTML, aber nicht im CSSOM)
  → Dev-Server neustarten, nicht debuggen. Gebauter Stand (`npm run preview`) ist die Wahrheit.
- **Lockfile nie aus bestehendem Windows-`node_modules` regenerieren** — npm lässt dann Linux/wasm-Optionals
  (`@emnapi/*`) aus und `npm ci` im CI bricht. Wenn Lockfile neu nötig: erst `node_modules` löschen.
  Die npm-Version im Workflow ist auf die lokale gepinnt — bei lokalem npm-Update mitziehen.
- **`docs/BELEG *.html` sind JS-Bundles** — Roh-HTML steckt JSON-encodiert in
  `<script type="__bundler/template">`. Zum Lesen extrahieren oder im Browser rendern; Werte stehen
  bereits extrahiert in design-tokens.md.
- Windows-Umgebung: PowerShell-Quoting beachten, `git add` warnt über CRLF (harmlos).

## Inhalte

Artikel unter `src/content/articles/` stammen aus der AI-News-Pipeline (echte Quellen). Die
ursprünglichen fiktiven Demo-Artikel sind entfernt. Keine echten Institutionen mit erfundenen
Zahlen in etwaigen Test-Artikeln verwenden.
