-- One durable quota ledger for this Geoapify account across every company,
-- application instance and staff member. No address/user/customer data is stored.
create schema if not exists crm_private;
create table crm_private.address_provider_requests (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null
);
create index address_provider_requests_requested_at_idx
  on crm_private.address_provider_requests (requested_at);
alter table crm_private.address_provider_requests enable row level security;
revoke all on crm_private.address_provider_requests from public, anon, authenticated;
grant usage on schema crm_private to service_role;
grant select, insert, delete on crm_private.address_provider_requests to service_role;

create or replace function public.crm_reserve_address_request()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reserved_at timestamptz;
  daily_count integer;
  recent_count integer;
  earliest timestamptz;
begin
  -- Transaction-scoped shared lock makes check + reservation atomic. Fixed scope
  -- intentionally cannot be overridden by callers or reset by a server restart.
  perform pg_catalog.pg_advisory_xact_lock(764312, 2500);
  -- Take wall clock AFTER obtaining the lock, avoiding stale transaction times.
  reserved_at := pg_catalog.clock_timestamp();
  delete from crm_private.address_provider_requests
    where requested_at <= reserved_at - interval '24 hours';
  select count(*), min(requested_at)
    into daily_count, earliest from crm_private.address_provider_requests;
  if daily_count >= 2500 then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'daily_limit',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from earliest + interval '24 hours' - reserved_at)))::integer);
  end if;
  select count(*) into recent_count from crm_private.address_provider_requests
    where requested_at > reserved_at - interval '1 second';
  if recent_count >= 4 then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'rate_limit', 'retry_after_seconds', 1);
  end if;
  insert into crm_private.address_provider_requests (requested_at) values (reserved_at);
  -- Never refund failed/time-out/cancelled provider attempts: they may still bill.
  return pg_catalog.jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.crm_reserve_address_request() from public, anon, authenticated;
grant execute on function public.crm_reserve_address_request() to service_role;
comment on function public.crm_reserve_address_request() is
  'Server-only global Geoapify allowance: 2500 attempted requests per rolling 24h, four per rolling second. Fail closed on errors. Does not cover other applications sharing this provider account.';
