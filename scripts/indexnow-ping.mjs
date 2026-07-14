/**
 * IndexNow-Ping (SEO-Discovery-Versicherung, ergänzt sitemap-news.mjs).
 *
 * IndexNow ist ein Push-Protokoll: statt zu warten, bis ein Crawler die Sitemap
 * erneut liest, meldet die Site geänderte URLs aktiv. Teilnehmer: Bing, Yandex,
 * Seznam, Naver — NICHT Google (Google kennt keinen offenen Push-Endpoint; dort
 * zählen Sitemap-lastmod + Search Console). Läuft im Deploy-Workflow NACH dem
 * GitHub-Pages-Deploy, sonst wären die gemeldeten URLs noch nicht live.
 *
 * Quelle der URLs ist die bereits deployte Live-Sitemap (nicht das Run-Manifest):
 * so ist der Ping vom Pipeline-Lauf entkoppelt und meldet genau, was öffentlich
 * steht. Gemeldet werden nur Artikel-URLs mit <lastmod> innerhalb des Fensters —
 * frisch Publiziertes/Aktualisiertes, nicht das ganze Archiv bei jedem Deploy.
 *
 * Best-effort: jeder Fehler endet mit Exit 0, ein fehlgeschlagener Ping darf den
 * Deploy nicht rot färben.
 *
 * Env:
 *   INDEXNOW_KEY   (Pflicht) — 32-stelliger Key, muss unter
 *                  `${SITE}/${INDEXNOW_KEY}.txt` erreichbar sein (public/…).
 *   SITE           Basis-URL, Default https://neuenachrichten.at
 *   INDEXNOW_WINDOW_DAYS  Frischefenster in Tagen, Default 1 (Artikel wird Minuten
 *                  nach Publish deployt → lastmod liegt sicher darin; enges Fenster
 *                  vermeidet, bei jedem Deploy das halbe Archiv erneut zu melden)
 *   INDEXNOW_DRY_RUN=1    URLs nur ausgeben, nicht senden
 */
const API = 'https://api.indexnow.org/indexnow';
const SITE = (process.env.SITE || 'https://neuenachrichten.at').replace(/\/$/, '');
const KEY = process.env.INDEXNOW_KEY;
const WINDOW_DAYS = Number(process.env.INDEXNOW_WINDOW_DAYS || '1');
const DRY_RUN = process.env.INDEXNOW_DRY_RUN === '1';
const MAX_URLS = 10000; // IndexNow-Limit pro Request.

/** Alle <loc>-Werte eines Sitemap-XML (Index- wie URL-Sitemaps). */
function locs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** <url>-Einträge einer URL-Sitemap als { loc, lastmod }. */
function urlEntries(xml) {
  return [...xml.matchAll(/<url>(.*?)<\/url>/gs)].map((m) => {
    const block = m[1];
    return {
      loc: block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim(),
      lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim(),
    };
  });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'neuenachrichten-indexnow/1' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} für ${url}`);
  return res.text();
}

/** Alle URL-Sitemaps unter dem Index einsammeln (Index verweist auf sitemap-N.xml). */
async function collectSitemapUrls() {
  // Index bevorzugt; ohne Index (kleine Sites) direkt auf sitemap-0.xml zurückfallen.
  try {
    const index = await fetchText(`${SITE}/sitemap-index.xml`);
    const subs = locs(index).filter((u) => /sitemap-\d+\.xml$/.test(u));
    if (subs.length > 0) return subs;
  } catch {
    /* kein Index — Fallback unten */
  }
  return [`${SITE}/sitemap-0.xml`];
}

async function main() {
  if (!KEY) {
    console.error('INDEXNOW_KEY fehlt — Ping übersprungen.');
    return;
  }

  const host = new URL(SITE).host;
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;

  const seen = new Set();
  const urlList = [];
  for (const sitemapUrl of await collectSitemapUrls()) {
    let xml;
    try {
      xml = await fetchText(sitemapUrl);
    } catch (error) {
      console.warn(`Sitemap nicht lesbar (${sitemapUrl}): ${error.message}`);
      continue;
    }
    for (const { loc, lastmod } of urlEntries(xml)) {
      // Nur Artikel mit frischem lastmod — statische Seiten haben keinen und
      // fallen so von selbst raus; das Archiv wird nicht bei jedem Deploy geflutet.
      if (!loc || !lastmod) continue;
      if (!/\/artikel\/[^/]+\/$/.test(new URL(loc).pathname)) continue;
      if (Date.parse(lastmod) < cutoff) continue;
      if (seen.has(loc)) continue;
      seen.add(loc);
      urlList.push(loc);
    }
  }

  if (urlList.length === 0) {
    console.log(`IndexNow: keine Artikel-URLs jünger als ${WINDOW_DAYS} d — nichts zu melden.`);
    return;
  }
  if (urlList.length > MAX_URLS) {
    console.warn(`IndexNow: ${urlList.length} URLs > Limit ${MAX_URLS} — auf ${MAX_URLS} gekappt.`);
    urlList.length = MAX_URLS;
  }

  const payload = { host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList };
  console.log(`IndexNow: ${urlList.length} URL(s):\n  ${urlList.join('\n  ')}`);

  if (DRY_RUN) {
    console.log('Dry-Run — nicht gesendet.');
    return;
  }

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  // 200 = angenommen, 202 = angenommen (Key-Validierung asynchron). Alles andere loggen,
  // aber nicht failen (best-effort — Deploy bleibt grün).
  console.log(`IndexNow-Antwort: ${res.status} ${res.statusText}`);
  if (!res.ok) console.warn(`IndexNow-Body: ${(await res.text()).slice(0, 500)}`);
}

main().catch((error) => {
  console.error(`IndexNow-Ping fehlgeschlagen (ignoriert): ${error.message}`);
});
