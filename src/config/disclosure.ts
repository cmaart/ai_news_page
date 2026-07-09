/**
 * Zentrale Disclosure-Texte. Die Disclosure-Box wird im Artikel-Layout
 * IMMER gerendert — der Text wird strukturell aus generationMode und
 * editorialReview abgeleitet und kann nicht pro Artikel weggelassen werden.
 */

export type GenerationMode = 'ai_generated' | 'ai_assisted' | 'manually_reviewed';
export type EditorialReview = 'none' | 'basic' | 'full';

export const GENERATION_MODE_LABELS: Record<GenerationMode, string> = {
  ai_generated: 'Automatisch erstellt',
  ai_assisted: 'KI-gestützt erstellt',
  manually_reviewed: 'Manuell geprüft',
};

export const EDITORIAL_REVIEW_LABELS: Record<EditorialReview, string> = {
  none: 'Nicht redaktionell geprüft',
  basic: 'Stichprobenartig menschlich geprüft',
  full: 'Menschlich geprüft',
};

const MODE_SENTENCES: Record<GenerationMode, string> = {
  ai_generated:
    'Dieser Artikel wurde automatisiert aus öffentlich zugänglichen Quellen, Claims und Kontextinformationen erstellt.',
  ai_assisted:
    'Dieser Artikel wurde KI-gestützt aus öffentlich zugänglichen Quellen, Claims und Kontextinformationen erstellt.',
  manually_reviewed:
    'Dieser Artikel wurde KI-gestützt erstellt und anschließend manuell geprüft.',
};

const REVIEW_SENTENCES: Record<EditorialReview, string> = {
  none: 'Es fand keine menschlich-redaktionelle Prüfung statt.',
  basic: 'Er wurde stichprobenartig menschlich geprüft, aber nicht vollständig verifiziert.',
  full: 'Er wurde vollständig menschlich gegengelesen.',
};

const ADVICE_SENTENCE =
  'Bitte prüfe die angegebenen Quellen selbst, besonders bei sensiblen oder aktuellen Themen.';

export function disclosureText(mode: GenerationMode, review: EditorialReview): string {
  return `${MODE_SENTENCES[mode]} ${REVIEW_SENTENCES[review]} ${ADVICE_SENTENCE}`;
}

/** Globaler Hinweis für Footer und Methodikseite. */
export const GLOBAL_DISCLOSURE =
  'Diese Website veröffentlicht Nachrichtenartikel auf Basis KI-gestützter Recherche in öffentlich zugänglichen Quellen. ' +
  'Die Inhalte werden automatisiert erzeugt und sind nicht notwendigerweise menschlich-redaktionell geprüft.';

/** Kernclaim für Startseite und Meta-Beschreibungen. */
export const SITE_CLAIM =
  'Nachrichten auf Basis KI-gestützter Recherche mit offener Quellenlage. Automatisiert erstellt, nicht zwingend redaktionell geprüft.';
