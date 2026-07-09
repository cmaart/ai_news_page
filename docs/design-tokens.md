# Design-Tokens (extrahiert aus Vorlagen „BELEG Artikelseite.html" + „BELEG Startseite.html")

Exakte Werte der Design-Vorlagen. Umsetzung als CSS Custom Properties in `src/styles/global.css`.

## Farben

| Token | Wert | Verwendung |
|-------|------|-----------|
| `--color-bg` | `#FBFAF7` | Seitenhintergrund |
| `--color-ink` | `#1C1B19` | Text, Überschriften, Border-Strong (2px), Dark-Sektionen (Newsletter-Block) |
| `--color-ink-soft` | `#2c2a26` | Fließtext-Body |
| `--color-text-muted` | `#48443d` | Standfirst, Nav-Links, Footer-Links, Methodik-Text |
| `--color-text-faint` | `#6E6A63` | Mono-Metadaten, Labels, Quellen-Nummern, Claim-Notes |
| `--color-text-ghost` | `#8a857c` | Header-Tagline, Footer-Copyright, Footer-Spalten-Labels |
| `--color-border` | `#E4E0D8` | Standard-Hairlines, Kacheln-Trenner, Meter-Leer |
| `--color-border-soft` | `#D6D1C7` | Separatoren (·, \|), Sekundär-Badge-Border |
| `--color-surface` | `#F4F1EA` | Kurzfazit-Box, Methodikbox-Header |
| `--color-surface-white` | `#fff` | Methodikbox-Body |
| `--color-meter-neutral` | `#B4AEA2` | Status „Unklar"-Dot |
| `--color-dark-border` | `#4a463f` | Border im Dark-Block |
| `--color-dark-muted` | `#B4AEA2` | Muted-Text im Dark-Block |

### Akzentfarben (oklch)

| Token | Wert | Verwendung |
|-------|------|-----------|
| `--accent` | `oklch(0.5 0.06 205)` | Teal: Links, Eyebrows, Meter gefüllt, KI-Dot, Kurzfazit-Checks, Schritt-Nummern |
| `--accent-hover` | `oklch(0.42 0.07 205)` | Link-Hover |
| `--accent-border` | `oklch(0.72 0.04 205)` | „Update"-Badge-Border |
| `--ok` | `oklch(0.5 0.07 155)` | Grün-Dot „Belegt" |
| `--ok-text` | `oklch(0.44 0.07 155)` | Grün-Text „Belegt", Primärquellen-Badge |
| `--ok-border` | `oklch(0.72 0.06 155)` | Primärquellen-Badge-Border |
| `--warn` | `oklch(0.62 0.11 70)` | Amber-Dot „Teilweise", Unklar-Box-Dot |
| `--warn-alt` | `oklch(0.62 0.1 70)` | Meter „Framing gering", Kurzfazit-„?" |
| `--warn-text` | `oklch(0.5 0.1 70)` | Amber-Text „Teilweise" |
| `--warn-deep` | `oklch(0.45 0.09 60)` | Unklar-Box-Label |
| `--warn-mid` | `oklch(0.55 0.1 65)` | Unklar-Box-Bullets |
| `--warn-border` | `oklch(0.75 0.06 70)` | Unklar-Box-Border |
| `--warn-bg` | `oklch(0.97 0.02 75)` | Unklar-Box-Hintergrund |
| `--danger-text` | `oklch(0.5 0.1 25)` | „Korrektur"-Badge-Text |
| `--danger-border` | `oklch(0.72 0.07 25)` | „Korrektur"-Badge-Border |
| Unklar-Box-Text | `#3a3428` | Fließtext in Warn-Box |

## Typografie

Fonts (self-hosted via @fontsource):
- **Spectral** (serif): 400 + italic, 500, 600 — Headlines, Fließtext, Claims, Kurzfazit, Kacheln-Werte
- **IBM Plex Sans**: 400, 500, 600 — UI, Nav, Standard-Body, Buttons
- **IBM Plex Mono**: 400, 500 — Metadaten, Labels, Quellen-URLs, Metriken, Timestamps

Fallbacks: `'IBM Plex Sans', system-ui, sans-serif` (Body-Default).

| Element | Font | Size/Weight/Sonstiges |
|---------|------|----------------------|
| Logo | Spectral 600 | 21px, letter-spacing .005em |
| Header-Tagline | Mono | 10px, ls .04em |
| Nav-Links | Sans | 13px |
| Eyebrow (Topic) | Sans 600 | 11px, ls .16em, uppercase |
| H1 Artikel | Spectral 600 | 44px, lh 1.12, ls -.015em |
| Standfirst | Spectral 400 | 20px, lh 1.5 |
| Metadaten-Zeile | Mono | 11px, ls .02em |
| Kacheln-Label | Mono | 9px, ls .08em, uppercase |
| Kacheln-Wert | Spectral 600 | 19px |
| Kurzfazit-Label | Sans 600 | 11px, ls .14em, uppercase |
| Kurzfazit-Items | Spectral | 16.5px, lh 1.5 |
| Body-Absatz | Spectral | 18px, lh 1.68, margin-bottom 22px |
| H2 im Body | Spectral 600 | 26px, lh 1.25, ls -.01em, margin 38px 0 16px |
| Sektions-H2 | Spectral 600 | 24px, border-bottom 2px solid ink, padding-bottom 12px |
| Claim-Text | Spectral | 17px, lh 1.5 |
| Claim-Note | Sans | 13px, lh 1.55 |
| Claim-Status-Badge | Sans 600 | 11px, ls .04em, uppercase, Dot 8px rund |
| Quellen-Titel | Spectral | 15px |
| Quellen-URL | Mono | 11px |
| Quellen-Typ-Badge | Sans 600 | 10px, ls .05em, uppercase, border 1px, padding 3px 8px |
| Korrektur-Datum | Mono | 11px |
| Korrektur-Text | Spectral | 14.5px, lh 1.55 |
| Card-Titel | Spectral 600 | 18px, lh 1.28 |
| Card-Metriken | Mono | 10px |
| Footer-Copyright | Mono | 10.5px |

## Layout

- Seitenbreite: Header/Footer/Cards-Grid `max-width: 1080px`; Artikel-Meta/Sektionen `760px`; Body-Fließtext `660px`; alle `padding: 0 40px`
- Header: sticky, `rgba(251,250,247,0.92)` + `backdrop-filter: blur(8px)`, border-bottom 1px
- Prüfband: 4-spaltig, `border-top: 2px solid ink`, `border-bottom: 1px`, Kacheln durch 1px-Border getrennt, Meter = 5 Segmente à 5px Höhe, gap 2px
- Kurzfazit-Box: `background: surface`, 1px border, padding 26px 30px
- Claims: Grid `130px 1fr`, gap 20px, 1px Trenner, padding 20px 0
- Unklar-Box: warn-bg + warn-border, padding 24px 28px
- Methodikbox: weiß, 1px border; Header-Zeile surface; Body 2×2-Grid, gap 22px
- Quellen: Grid `28px 1fr auto`, 1px Trenner oben, padding 13px 0
- Korrekturen: Grid `150px 1fr`, gap 18px
- Cards („Weiterlesen"): 3-spaltig, gap 32px
- Dark-Block (Newsletter, v1 weggelassen): bg ink, Text `#FBFAF7`, padding 40px 44px
- Footer: Grid `2fr 1fr 1fr 1fr`, gap 32px; Copyright-Zeile 1px border-top
- Links: accent, kein underline; hover: accent-hover + underline, `text-underline-offset: 2px`
- `-webkit-font-smoothing: antialiased`

## Startseite (aus „BELEG Startseite.html")

- Masthead-Dateline unter Header: Datum links („Donnerstag, 9. Juli 2026"), rechts Dot + Claim; Mono 10.5px, ls .06em, uppercase, `#6E6A63`, border-bottom 1px
- Lead-Grid: `1.55fr 1fr`, gap 44px; Lead mit border-right + padding-right 44px; Lead-H2 Spectral 600 38px lh1.14 ls-.015em; Standfirst Spectral 18px `#48443d`
- Lead-Metrikzeile: Mini-Meter (5 Segmente 9×5px, gap 2px) + Mono 10.5px uppercase, Separator `|` in `#D6D1C7`
- Top-Liste rechts: Mono-Label 10px uppercase mit 2px-Unterstrich; Items 18px 0 Padding, 1px Trenner; H3 Spectral 600 19px lh1.25; Metriken Mono 9.5px (`QS 4/5`, `RISK 3/5`, `4 PRIM`)
- Dunkles Band: bg ink, Text `#E7E3DB`, padding 30px 36px, Grid `auto 1fr auto` gap 32; 4 Schritte (Mono-Nummer in `oklch(0.68 0.07 205)`, Text 13px); Button-Link 1px border `#4a463f`
- Sektionskopf: Spectral 600 22px + Mono-11px-Link rechts, 2px border-bottom ink
- Themen-Grid: 3-spaltig ohne gap, Zellen padding 20px 24px, Hairline-Border rechts/unten (erste Spalte pl 0, letzte pr 0 + kein border-right); Name Spectral 600 18px, Count Mono 10.5px
- Neueste-Grid: 3-spaltig ohne gap, Zellen padding 24px 28px 26px, gleiche Border-Logik; Kopfzeile Eyebrow 10px + Datum Mono 10px `#9a948a`; H3 19px lh1.26; Teaser 13.5px `#6E6A63`; Metriken Mono 9.5px mit farbigem `● BELEGT x/y` (ok) / `● TEILS BELEGT` (warn)
- Story-Hover: Titel → accent-hover (transition .15s)
- Vorlage-Breite 1140px → bei uns 1024px (Entscheidung 23); Newsletter-Block + Archiv-Button + „Über uns" nicht übernommen; Methodik-Band-Texte neu formuliert (Vorlage behauptet menschliche Redaktion)

## Muster

- Status-Dots: 8px rund (Claims), 9px (Box-Header), 6px (KI-Hinweis in Metazeile)
- Meter: 5 Segmente, gefüllt = accent (bzw. warn bei Risiko), leer = border-Farbe
- Badges: outline-Stil (1px Border, Textfarbe = Semantikfarbe), nie gefüllt
- Anker: Quellen-IDs `#src1…`, Claims `#claims`, `scroll-margin-top: 80px` (sticky Header)
