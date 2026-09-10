-- Run only after the worker is deployed and its matching secret is saved in Vault
-- as air_king_crm_worker_secret. Never put the secret in this file.
begin;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='air_king_crm_worker_secret') then
    raise exception 'Save the matching CRM_WORKER_SECRET in Supabase Vault first.';
  end if;
end $$;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
  'air-king-communications-worker', '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://air-king-crm.onrender.com/api/internal/communications/tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='air_king_crm_worker_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
commit;
