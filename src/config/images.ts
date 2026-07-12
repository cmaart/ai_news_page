/**
 * Bild-Lizenz-Allowlist (PLAN.md E44) — einzige Quelle der Wahrheit für
 * Zod-Schema, validate.ts, Pipeline und UI. Nur Lizenzen, die automatisierte
 * Nutzung mit Namensnennung erlauben; NC/ND bewusst ausgeschlossen.
 * `press_permission` = ausdrückliche Presse-Freigabe der Institution
 * (Nachweis: credit.termsUrl + credit.termsQuote).
 */
export const IMAGE_LICENSES = [
  'CC0 1.0',
  'Public Domain',
  'CC BY 2.0',
  'CC BY 2.5',
  'CC BY 3.0',
  'CC BY 3.0 AT',
  'CC BY 3.0 DE',
  'CC BY 4.0',
  'CC BY-SA 2.0',
  'CC BY-SA 2.5',
  'CC BY-SA 3.0',
  'CC BY-SA 3.0 AT',
  'CC BY-SA 3.0 DE',
  'CC BY-SA 3.0 IGO',
  'CC BY-SA 4.0',
  'press_permission',
] as const;

export type ImageLicense = (typeof IMAGE_LICENSES)[number];

/** Kanonische Lizenz-URLs — deterministisch abgeleitet, nie vom Modell übernommen. */
export const LICENSE_URLS: Record<string, string> = {
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  'CC BY 2.5': 'https://creativecommons.org/licenses/by/2.5/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 3.0 AT': 'https://creativecommons.org/licenses/by/3.0/at/',
  'CC BY 3.0 DE': 'https://creativecommons.org/licenses/by/3.0/de/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY-SA 2.5': 'https://creativecommons.org/licenses/by-sa/2.5/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 3.0 AT': 'https://creativecommons.org/licenses/by-sa/3.0/at/',
  'CC BY-SA 3.0 DE': 'https://creativecommons.org/licenses/by-sa/3.0/de/',
  'CC BY-SA 3.0 IGO': 'https://creativecommons.org/licenses/by-sa/3.0/igo/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

/**
 * Wikimedia-Commons-Lizenzangabe (extmetadata `License`-Code bzw.
 * `LicenseShortName`) → Allowlist-Enum (PLAN.md E49). Nur Lizenzen, die
 * kommerzielle Nutzung UND Bearbeitung (Resize) erlauben; ND/GFDL-only/
 * fair-use/unbekannt ⇒ null = ablehnen. Country-Varianten (…-de/-at) und
 * Versionen werden auf die generische Allowlist-Lizenz abgebildet.
 */
export function commonsLicenseToAllowlist(code: string, shortName?: string): ImageLicense | null {
  const c = code.trim().toLowerCase();
  const exact: Record<string, ImageLicense> = {
    cc0: 'CC0 1.0',
    'cc0-1.0': 'CC0 1.0',
    pd: 'Public Domain',
    'public domain': 'Public Domain',
    'cc-by-2.0': 'CC BY 2.0',
    'cc-by-2.5': 'CC BY 2.5',
    'cc-by-3.0': 'CC BY 3.0',
    'cc-by-4.0': 'CC BY 4.0',
    'cc-by-sa-2.0': 'CC BY-SA 2.0',
    'cc-by-sa-2.5': 'CC BY-SA 2.5',
    'cc-by-sa-3.0': 'CC BY-SA 3.0',
    'cc-by-sa-4.0': 'CC BY-SA 4.0',
  };
  if (exact[c]) return exact[c];
  // Country-/Sub-Varianten auf die generische Version mappen (z. B. cc-by-sa-3.0-de).
  if (/^cc-by-sa-3\.0(-|$)/.test(c)) return 'CC BY-SA 3.0';
  if (/^cc-by-3\.0(-|$)/.test(c)) return 'CC BY 3.0';
  if (c.startsWith('pd-') || c.startsWith('public-domain')) return 'Public Domain';
  // Fallback: LicenseShortName exakt gegen die Allowlist; „Public domain" separat.
  const sn = shortName?.trim();
  if (sn) {
    if (sn.toLowerCase() === 'public domain') return 'Public Domain';
    if ((IMAGE_LICENSES as readonly string[]).includes(sn)) return sn as ImageLicense;
  }
  return null;
}

/** Anzeige-Label der Lizenz in Credit-Zeile und Bildnachweis. */
export function licenseLabel(license: string): string {
  return license === 'press_permission' ? 'Pressefoto, honorarfrei' : license;
}

/**
 * Link-Ziel der Lizenz-Angabe: CC-Lizenzen auf den Lizenztext,
 * Presse-Freigaben auf die Nutzungsbedingungen der Institution.
 */
export function licenseHref(license: string, termsUrl: string): string {
  return LICENSE_URLS[license] ?? termsUrl;
}
