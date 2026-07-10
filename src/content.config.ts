import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/articles' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    publishedAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
    topic: z.enum(['politik', 'wirtschaft', 'gesellschaft', 'technologie', 'wissenschaft']),
    country: z.enum(['at', 'de', 'eu', 'int']),
    status: z.enum(['draft', 'review', 'published', 'corrected', 'retracted', 'archived']),
    generationMode: z.enum(['ai_generated', 'ai_assisted', 'manually_reviewed']),
    editorialReview: z.enum(['none', 'basic', 'full']),
    confidence: z.enum(['low', 'medium', 'high']),
    /** Ein-Satz-Begründung je Metrik, Pflicht (PLAN.md E41) — Anzeige aufklappbar im Prüfband. */
    confidenceNote: z.string().min(1),
    primarySourceStrength: z.enum(['none', 'weak', 'medium', 'strong']),
    sourceStrengthNote: z.string().min(1),
    framingRisk: z.enum(['low', 'medium', 'high']),
    framingRiskNote: z.string().min(1),
    /** Nachrichtenwert 1–5, vergeben von der Haiku-Triage (PLAN.md E38). 3 = Default für Bestand. */
    newsworthiness: z.number().int().min(1).max(5).default(3),
    summary: z
      .array(
        z.object({
          text: z.string().min(1),
          kind: z.enum(['fact', 'open']),
        }),
      )
      .min(1),
    openQuestions: z.array(z.string().min(1)).default([]),
    sources: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          type: z.enum(['agency', 'media', 'primary', 'official', 'study', 'press_release', 'other']),
          url: z.url(),
        }),
      )
      .min(1),
    claims: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().min(1),
          status: z.enum(['supported', 'partial', 'unclear', 'contradicted']),
          note: z.string().optional(),
          sourceIds: z.array(z.string().min(1)).min(1),
        }),
      )
      .default([]),
    corrections: z
      .array(
        z.object({
          date: z.coerce.date(),
          type: z.enum(['correction', 'update']),
          text: z.string().min(1),
        }),
      )
      .default([]),
    retractionReason: z.string().optional(),
    aiDisclosureNote: z.string().optional(),
  }),
});

export const collections = { articles };
