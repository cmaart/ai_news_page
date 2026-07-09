/**
 * Interne Links immer über withBase() bauen: auf GitHub Pages ohne Custom
 * Domain liegt die Site unter einem Base-Pfad (/ai_news_page/), mit Custom
 * Domain unter /. site/base kommen im CI von actions/configure-pages.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
