# Neue Nachrichten

KI-gestützte News-Site mit offener Quellenlage. Jeder Artikel legt seine Vertrauensmetriken offen; dieses Glossar fixiert, was die Metriken bedeuten — für UI-Copy, Pipeline-Prompt und Methodik-Seite gleichermaßen.

## Language

**Konfidenz** (`confidence`):
Rein epistemisches Maß: wie sicher ist die Gesamtdarstellung nach vorliegender Quellenlage. Wird NICHT durch Themen-Sensibilität gedrosselt — Sensibilität lebt in `sensitivity` und steuert Tonalität/Triage, nicht diese Anzeige.
_Avoid_: Sicherheit, Verlässlichkeit, Vertrauenswürdigkeit

**Bestätigtes Ereignis**:
Ein Ereignis gilt als bestätigt, wenn (a) die handelnde Institution es selbst verkündet (Aussendung, Dokument, Urteil), oder (b) eine APA-Agenturmeldung es trägt, oder (c) zwei voneinander unabhängige Quellen es berichten. Mehrere Portale mit derselben Agenturmeldung = eine Quelle.

**OTS-Aussendung**:
Presseaussendung des Absenders, über APA-Infrastruktur nur verteilt, inhaltlich ungeprüft. Zählt nie als APA-Agenturmeldung: Bestätigungsgewicht = Gewicht des Absenders (handelnde Institution über eigenes Handeln ⇒ Fall a; Behauptung über Dritte ⇒ eine Parteistimme, treibt Einseitigkeit statt Konfidenz).
_Avoid_: APA-Meldung (für OTS-Inhalte)

**Sensibilität** (`sensitivity`):
Wie heikel das Thema ist (Suizid, Kriminalität, Gesundheit …). Steuert konservative Sprache und Claim-Einstufung, nicht die Konfidenz.

**Primärquellenstärke** (`primarySourceStrength`):
Wie belastbar die Primärquellenlage ist (amtliche Dokumente, Studien, Originalaussendungen). Medien-Renommee zählt nicht — ORF/derStandard sind Sekundärquellen.
_Avoid_: Quellenstärke (suggeriert Gesamtqualität aller Quellen)

**Technologie** (`topic: technologie`):
Digital-, IT- und KI-Themen als Gegenstand der Story — Produkte, Software, IT-Sicherheit, KI-Forschung (KI-Paper zählen hierher, nicht zu Wissenschaft). Dominiert aber ein politischer oder wirtschaftlicher Kontext (AI-Act-Strafe, Cyberangriff auf Ministerium, Quartalszahlen eines Tech-Konzerns), gewinnt der Kontext: Politik bzw. Wirtschaft.

**Wissenschaft** (`topic: wissenschaft`):
Forschungsergebnisse und Studien außerhalb der Digital-/KI-Welt — Naturwissenschaft, Medizin, Klima, Raumfahrt.

**Pressefoto** (`image`):
Bild aus dem offiziellen Pressefoto-Angebot einer im Artikel zitierten Institution mit ausdrücklichem Nutzungsrecht. Einzige zulässige Bildquelle der Site. Bilder aus Quell-Artikeln der Medien sind nie mitlizenziert — Quellenangabe ersetzt keine Lizenz.
_Avoid_: „Bild aus der Quelle", Symbolfoto von Stock-Anbietern

**Symbolbild / Ereignisfoto** (`image.kind`):
`symbol` = Bild zeigt nicht das berichtete Ereignis selbst (Gebäude, Porträt, Archivbild) — Caption kennzeichnet „(Symbolbild)". `direct` = zeigt das Ereignis; muss aktiv gesetzt werden, Default ist `symbol`.

**Bild-Whitelist**:
Kuratierte Liste manuell geprüfter Pressefoto-Einträge (`data/ai-news/image-sources.yaml`) — einzige Bildquelle der Pipeline. Aufnahme nur nach menschlicher Prüfung der Nutzungsbedingungen; die Pipeline wählt daraus deterministisch (Keyword-/Domain-Match), nie per KI-Interpretation.

**Bildnachweis**:
Zentrales, auto-generiertes Verzeichnis aller Bild-Credits (`/bildnachweis`, Footer-Link). Deckt die Attributionspflicht für Teaser-Nutzungen ab; auf der Artikelseite steht der Credit zusätzlich sichtbar unter dem Bild.

**Resonanz** (`resonance`):
Beobachtetes Medienecho zu einem bereits publizierten Artikel: wie breit greifen unabhängige Quellen die Story nach Publikation weiter auf. Reine Beobachtung mit Messzeitpunkt, kein Urteil — ergänzt den Nachrichtenwert (`newsworthiness`, intrinsisches Triage-Urteil), ersetzt ihn nie und verändert ihn nicht. Agentur-Syndikation (mehrere Portale, derselbe Agenturtext) ist keine Resonanz. Resonanz klingt ab: ohne frisches Echo verliert sie ihren Einfluss von selbst.
_Avoid_: Relevanz (= errechneter Ranking-Score), Nachrichtenwert, Reichweite (wir messen Berichterstattung, nicht Publikum)

**Einseitigkeit** (`framingRisk`):
Risiko, dass die Darstellung einseitig gefärbt ist, weil die verfügbaren Quellen eine Perspektive dominieren. Rubrik: **gering** = mehrere unabhängige Perspektiven, Gegenseite aus direkt eingesehener Quelle · **mittel** = eine Perspektive dominiert oder Gegenseite nur aus zweiter Hand · **hoch** = nur Darstellung einer Seite, Gegenseite fehlt.
