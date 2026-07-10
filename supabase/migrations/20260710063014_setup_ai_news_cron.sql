-- Scheduler für die AI-News-Pipeline: pg_cron ruft alle 30 Minuten die Edge
-- Function `trigger-ai-news` auf, die den GitHub-Actions-Workflow per
-- workflow_dispatch startet (GitHub-`schedule` ist zu unzuverlässig, 1–4 h Drift).
--
-- Voraussetzung (einmalig, NICHT in Migrationen — Secrets gehören nicht ins Repo):
--   select vault.create_secret('https://gmpxplyjbcabliuzhfne.supabase.co', 'project_url');
--   select vault.create_secret('sb_secret_...', 'edge_trigger_secret_key');
-- Siehe docs/supabase-scheduler.md.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net;

-- cron.schedule ist idempotent pro Job-Name (ersetzt bestehenden Job).
-- Minuten 7/37 wie zuvor im GitHub-Cron, volle Stunden meiden.
select cron.schedule(
  'trigger-ai-news-research',
  '7,37 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/trigger-ai-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_trigger_secret_key')
    ),
    body := jsonb_build_object('scheduledAt', now()),
    timeout_milliseconds := 10000
  ) as request_id;
  $$
);
