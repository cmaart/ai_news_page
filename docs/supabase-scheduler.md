# Supabase-Scheduler für die AI-News-Pipeline

GitHub-Actions-`schedule` ist best-effort: Der 30-min-Cron (`7,37 * * * *`) lief real mit
1–4 h Drift (z. B. 4 h 22 min Lücke am 2026-07-10). Deshalb übernimmt Supabase das Scheduling
(Entscheidung E39): **pg_cron → Edge Function `trigger-ai-news` → GitHub `workflow_dispatch`**.
`workflow_dispatch` feuert sofort und wird nicht gedrosselt.

Projekt: `gmpxplyjbcabliuzhfne` · https://gmpxplyjbcabliuzhfne.supabase.co

## Bausteine im Repo

| Datei | Zweck |
| --- | --- |
| `supabase/config.toml` | CLI-Konfiguration; `[functions.trigger-ai-news] verify_jwt = false` (Auth macht der Function-Code) |
| `supabase/migrations/20260710063014_setup_ai_news_cron.sql` | Aktiviert `pg_cron` + `pg_net`, legt Cron-Job `trigger-ai-news-research` an (`7,37 * * * *`) |
| `supabase/migrations/20260710105445_ai_news_cron_hourly.sql` | Reduziert den Cron-Job auf stündlich (`7 * * * *`) |
| `supabase/functions/trigger-ai-news/index.ts` | Edge Function: ruft GitHub `workflow_dispatch` für `ai-news-research.yml` auf. Auth: `withSupabase({ auth: 'secret' })` (npm-Paket `@supabase/server`) — nur Secret-API-Keys des Projekts kommen durch, die Function ist nicht öffentlich auslösbar |

Ablauf zur Laufzeit: pg_cron führt stündlich `net.http_post` aus (URL + Secret-Key aus dem
**Vault**), die Edge Function schickt mit dem GitHub-PAT den Dispatch, GitHub startet den Workflow.

## Deployment (einmalig)

Voraussetzung: Supabase CLI ist devDependency (`npx supabase …`), Login via `npx supabase login`.

1. **Projekt linken**

   ```bash
   npx supabase link --project-ref gmpxplyjbcabliuzhfne
   ```

2. **GitHub-PAT erzeugen** (github.com → Settings → Developer settings → Fine-grained tokens):
   Repository `cmaart/ai_news_page`, Permission **Actions: Read and write**, sonst nichts.
   Ablaufdatum notieren — Rotation ist manuell.

3. **Function-Secrets setzen**

   ```bash
   npx supabase secrets set GH_WORKFLOW_PAT=github_pat_…
   # optional (Defaults im Code): GH_REPO, GH_WORKFLOW_FILE, GH_REF
   ```

4. **Edge Function deployen**

   ```bash
   npx supabase functions deploy trigger-ai-news
   ```

5. **Vault-Secrets anlegen** (Dashboard → SQL Editor; Secret-API-Key aus
   Dashboard → Settings → API Keys, `sb_secret_…`). Bewusst **nicht** in der Migration —
   Secrets gehören nicht ins Repo:

   ```sql
   select vault.create_secret('https://gmpxplyjbcabliuzhfne.supabase.co', 'project_url');
   select vault.create_secret('sb_secret_…', 'edge_trigger_secret_key');
   ```

6. **Migration pushen**

   ```bash
   npx supabase db push
   ```

Reihenfolge 5 vor 6 ist nicht kritisch (der Cron-Job liest die Vault-Secrets erst zur
Laufzeit), aber so gibt es keine fehlgeschlagenen ersten Läufe.

## Verifizieren

```bash
# Function direkt testen (ersetzt sb_secret_… durch echten Key):
curl -s -X POST "https://gmpxplyjbcabliuzhfne.supabase.co/functions/v1/trigger-ai-news" \
  -H "apikey: sb_secret_…" -H "Content-Type: application/json" -d "{}"
# Erwartung: {"ok":true,…} und neuer workflow_dispatch-Run:
gh run list --workflow "AI News Research" --limit 3
```

Cron-Ausführungen prüfen (SQL Editor):

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
select id, status_code, error_msg from net._http_response order by id desc limit 10;
```

## Nach erfolgreicher Verifikation

- [x] E2E verifiziert (2026-07-10): manueller `net.http_post` aus der DB ⇒ `{"ok":true}` ⇒
      `workflow_dispatch`-Run gestartet.
- [x] `schedule:`-Trigger aus `.github/workflows/ai-news-research.yml` entfernt (sonst
      Doppel-Läufe: GitHub-Cron **und** Supabase feuern; die `concurrency`-Group fängt nur
      zeitgleiche Läufe ab, nicht versetzte). `workflow_dispatch` bleibt.
- [ ] Einen Tag `run-history.jsonl` beobachten: Läufe sollten stabil bei :07 liegen.

## Betrieb / Stolpersteine

- **PAT läuft ab** → Dispatch liefert 401, Edge-Function-Log zeigt `workflow_dispatch
  fehlgeschlagen: 401`. Neues PAT, `npx supabase secrets set GH_WORKFLOW_PAT=…`, kein Redeploy nötig.
- **Job pausieren:** `select cron.unschedule('trigger-ai-news-research');` — Re-Aktivierung
  durch erneutes Ausführen des `cron.schedule`-Blocks aus der Migration.
- **Secret-Key rotieren:** neuen Key im Dashboard erzeugen, dann
  `select vault.update_secret((select id from vault.secrets where name = 'edge_trigger_secret_key'), 'sb_secret_…');`
- Fehlerbenachrichtigung: unverändert GitHub-Failure-Mail des Workflows (E35). Schlägt schon
  der Dispatch fehl, sieht man das nur in `net._http_response` / Edge-Function-Logs — bei
  Verdacht dort zuerst schauen.
