-- Trigger-Frequenz der AI-News-Pipeline von alle 30 Minuten auf stündlich
-- reduzieren. cron.schedule ist idempotent pro Job-Name und ersetzt den
-- bestehenden Job aus 20260710063014_setup_ai_news_cron.sql.
-- Minute 7 beibehalten, volle Stunden meiden.

select cron.schedule(
  'trigger-ai-news-research',
  '7 * * * *',
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
