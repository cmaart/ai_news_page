// Startet einen GitHub-Actions-Workflow per workflow_dispatch.
// Aufrufer: pg_cron-Jobs `trigger-ai-news-research` (alle 2 h, Pipeline) und
// `trigger-daily-site-rebuild` (täglich, deploy.yml — Resonanz-Decay braucht
// Builds auch ohne Content-Pushes, PLAN.md E46). Der Ziel-Workflow kommt
// optional aus dem Request-Body ({"workflow": "deploy.yml"}), strikt gegen
// eine Allowlist geprüft. Auth: nur Secret-API-Keys des Projekts
// (`auth: 'secret'`), damit die Function nicht öffentlich auslösbar ist —
// jeder Dispatch kostet einen echten Pipeline-Lauf inkl. API-Credits.
//
// Benötigte Function-Secrets (supabase secrets set …):
//   GH_WORKFLOW_PAT  – fine-grained PAT, Repo cmaart/ai_news_page, Permission "Actions: write"
// Optional (Defaults unten):
//   GH_REPO, GH_WORKFLOW_FILE, GH_REF

import { withSupabase } from 'npm:@supabase/server@1.3.0'

const DEFAULT_REPO = 'cmaart/ai_news_page'
const DEFAULT_WORKFLOW = 'ai-news-research.yml'
const DEFAULT_REF = 'main'
const ALLOWED_WORKFLOWS = new Set(['ai-news-research.yml', 'deploy.yml'])

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req) => {
    const pat = Deno.env.get('GH_WORKFLOW_PAT')
    if (!pat) {
      return Response.json(
        { ok: false, error: 'Secret GH_WORKFLOW_PAT ist nicht gesetzt' },
        { status: 500 },
      )
    }

    let requestedWorkflow: string | undefined
    try {
      const body = await req.json()
      if (typeof body?.workflow === 'string') requestedWorkflow = body.workflow
    } catch {
      // Kein/kein-JSON-Body ⇒ Default-Workflow (bestehende Cron-Aufrufe).
    }
    if (requestedWorkflow && !ALLOWED_WORKFLOWS.has(requestedWorkflow)) {
      return Response.json(
        { ok: false, error: `Workflow nicht in der Allowlist: ${requestedWorkflow}` },
        { status: 400 },
      )
    }

    const repo = Deno.env.get('GH_REPO') ?? DEFAULT_REPO
    const workflow = requestedWorkflow ?? Deno.env.get('GH_WORKFLOW_FILE') ?? DEFAULT_WORKFLOW
    const ref = Deno.env.get('GH_REF') ?? DEFAULT_REF

    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'supabase-trigger-ai-news',
        },
        body: JSON.stringify({ ref }),
      },
    )

    // GitHub antwortet bei Erfolg mit 204 No Content.
    if (res.status === 204) {
      return Response.json({ ok: true, dispatched: { repo, workflow, ref } })
    }

    const detail = await res.text()
    console.error(`workflow_dispatch fehlgeschlagen: ${res.status} ${detail}`)
    return Response.json(
      { ok: false, status: res.status, error: detail },
      { status: 502 },
    )
  }),
}
