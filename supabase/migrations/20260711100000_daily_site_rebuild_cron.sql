-- Täglicher Fallback-Rebuild der Site (PLAN.md E46): der Resonanz-Einfluss im
-- Relevanz-Ranking klingt über einen Zeit-Decay ab, der nur beim Build
-- ausgewertet wird — ohne Content-Pushes bliebe eine abgeebbte Welle sonst im
-- Aufmacher eingefroren. Dispatcht deploy.yml über dieselbe Edge Function wie
-- die Pipeline (Body-Parameter workflow, Allowlist in der Function).
-- Uhrzeit bewusst abseits voller Stunden und des Pipeline-Crons (Minute 7).

select cron.schedule(
  'trigger-daily-site-rebuild',
  '19 5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/trigger-ai-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_trigger_secret_key')
    ),
    body := jsonb_build_object('workflow', 'deploy.yml', 'scheduledAt', now()),
    timeout_milliseconds := 10000
  ) as request_id;
  $$
);
