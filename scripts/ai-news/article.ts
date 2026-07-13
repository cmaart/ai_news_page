/**
 * MDX-Serialisierung (PLAN.md E33/E34): bestehendes Frontmatter-Schema
 * unverändert, Slug = Dateiname, semantisch mit Kollisionscheck.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { stringify } from 'yaml';
import type { DraftResult } from './types.ts';
import { slugify } from './util.ts';

export const ARTICLES_DIR = join(process.cwd(), 'src', 'content', 'articles');

interface Correction {
  date: string;
  type: 'correction' | 'update';
  text: string;
}

export function resolveSlug(suggestion: string, title: string): string {
  const base = slugify(suggestion) || slugify(title) || 'artikel';
  let slug = base;
  let n = 2;
  while (existsSync(join(ARTICLES_DIR, `${slug}.mdx`))) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export function readExistingArticle(slug: string): { frontmatter: Record<string, unknown>; frontmatterYaml: string; body: string } | null {
  const path = join(ARTICLES_DIR, `${slug}.mdx`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as Record<string, unknown>,
    frontmatterYaml: stringify(parsed.data),
    body: parsed.content.trim(),
  };
}

export interface WriteArticleOptions {
  slug: string;
  draft: DraftResult;
  newsworthiness: number; // 1–5 aus der Triage (PLAN.md E38)
  publishedAt?: string; // bestehendes publishedAt bei Updates
  existingCorrections?: Correction[];
  updateNote?: string;
  nowIso: string;
  /** Fertiges Frontmatter-image-Objekt (E44); bei Updates ohne neues Bild das bestehende. */
  image?: Record<string, unknown>;
  /** Bestehendes resonance-Objekt (E46) — bei Updates unverändert durchreichen. */
  resonance?: Record<string, unknown>;
  /** Verwandte Artikel derselben Story (E53) — Slugs; leer = kein Feld im Frontmatter. */
  relatedSlugs?: string[];
}

/**
 * Schreibt den Artikel als MDX; gibt den relativen Pfad zurück.
 * Immer `status: published` + `publishedAt` — alle Artikel gehen direkt auf
 * main, auch sensitivity high (PLAN.md E30, revidiert 2026-07-11).
 */
export function writeArticle(options: WriteArticleOptions): string {
  const { slug, draft, newsworthiness, existingCorrections = [], updateNote, nowIso } = options;

  const corrections: Correction[] = [...existingCorrections];
  if (updateNote) {
    corrections.push({ date: nowIso, type: 'update', text: updateNote });
  }

  const frontmatter: Record<string, unknown> = {
    title: draft.title,
    description: draft.description,
    publishedAt: options.publishedAt ?? nowIso,
  };
  if (corrections.length > 0) {
    // validate.ts verlangt updatedAt === jüngstes corrections-Datum.
    frontmatter.updatedAt = corrections.map((c) => c.date).sort().at(-1);
  }

  Object.assign(frontmatter, {
    topic: draft.topic,
    country: draft.country,
    status: 'published',
    generationMode: 'ai_generated',
    editorialReview: 'none',
    confidence: draft.confidence,
    confidenceNote: draft.confidenceNote,
    primarySourceStrength: draft.primarySourceStrength,
    sourceStrengthNote: draft.sourceStrengthNote,
    framingRisk: draft.framingRisk,
    framingRiskNote: draft.framingRiskNote,
    newsworthiness,
    ...(options.resonance ? { resonance: options.resonance } : {}),
    summary: draft.summary,
    openQuestions: draft.openQuestions,
    ...(options.relatedSlugs && options.relatedSlugs.length > 0 ? { relatedSlugs: options.relatedSlugs } : {}),
    sources: draft.sources,
    claims: draft.claims.map((c) => ({
      id: c.id,
      text: c.text,
      status: c.status,
      ...(c.note ? { note: c.note } : {}),
      sourceIds: c.sourceIds,
    })),
    corrections,
    ...(options.image ? { image: options.image } : {}),
  });

  const standardBody = draft.body
    .map((section) => `## ${section.heading.replace(/^#+\s*/, '')}\n\n${section.markdown.trim()}`)
    .join('\n\n');
  // Beide Textlängen in Wrappern (PLAN.md E37); Leerzeilen nach/vor den Tags
  // sind Pflicht, damit MDX den Inhalt als Markdown-Blöcke parst.
  const body = `<Kompakt>\n\n${draft.bodyKompakt.trim()}\n\n</Kompakt>\n\n<Standard>\n\n${standardBody}\n\n</Standard>`;

  const yamlText = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  const mdx = `---\n${yamlText}\n---\n\n${body}\n`;

  const path = join(ARTICLES_DIR, `${slug}.mdx`);
  writeFileSync(path, mdx, 'utf8');
  return `src/content/articles/${slug}.mdx`;
}

/**
 * Setzt nur das resonance-Frontmatter (E46) eines bestehenden Artikels neu —
 * Body und alle übrigen Felder bleiben inhaltlich unverändert (Roundtrip über
 * gray-matter + yaml, wie beim regulären Schreiben). Gibt false zurück, wenn
 * die Artikeldatei nicht existiert.
 */
export function patchArticleResonance(
  slug: string,
  resonance: { level: number; measuredAt: string; source: 'zaehlung' | 'triage' },
): boolean {
  const path = join(ARTICLES_DIR, `${slug}.mdx`);
  if (!existsSync(path)) return false;
  const parsed = matter(readFileSync(path, 'utf8'));
  const frontmatter = { ...(parsed.data as Record<string, unknown>), resonance };
  const yamlText = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  writeFileSync(path, `---\n${yamlText}\n---\n\n${parsed.content.trim()}\n`, 'utf8');
  return true;
}

/**
 * Fügt dem bestehenden Artikel `slug` einen relatedSlugs-Rückverweis auf
 * `relatedSlug` hinzu (E53, bidirektionaler Cross-Link — analog
 * patchArticleResonance). Idempotent: schon vorhandene Verweise bleiben, Body
 * und übrige Felder unverändert. Gibt false zurück, wenn die Datei fehlt.
 */
export function patchArticleRelated(slug: string, relatedSlug: string): boolean {
  const path = join(ARTICLES_DIR, `${slug}.mdx`);
  if (!existsSync(path)) return false;
  const parsed = matter(readFileSync(path, 'utf8'));
  const data = parsed.data as Record<string, unknown>;
  const existing = Array.isArray(data.relatedSlugs) ? (data.relatedSlugs as string[]) : [];
  if (existing.includes(relatedSlug) || relatedSlug === slug) return true;
  const frontmatter = { ...data, relatedSlugs: [...existing, relatedSlug] };
  const yamlText = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  writeFileSync(path, `---\n${yamlText}\n---\n\n${parsed.content.trim()}\n`, 'utf8');
  return true;
}

export function listExistingSlugs(): Set<string> {
  try {
    return new Set(readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, '')));
  } catch {
    return new Set();
  }
}
