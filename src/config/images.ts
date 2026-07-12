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
