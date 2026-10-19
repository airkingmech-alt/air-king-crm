set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Phone suppression survives unmatched/duplicate customers and later imports.
-- Staff review never restores consent. Only the service can access this table.
create table public.sms_phone_suppressions (
 company_id text not null, phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
 created_at timestamptz not null default now(), primary key (company_id, phone)
);
alter table public.sms_phone_suppressions enable row level security;
revoke all on public.sms_phone_suppressions from public, anon, authenticated;
grant all on public.sms_phone_suppressions to service_role;

-- Shared office read state; existing company/feature RLS still applies to history.
alter table public.communication_events add column read_at timestamptz, add column read_by uuid;
create index crm_unread_sms on public.communication_events(company_id, created_at desc, id)
 where channel='sms' and read_at is null and event_type in ('sms.received','customer.opted_out');
create index crm_customer_phone_scan on public.customers(company_id,id);
alter table public.provider_webhook_events add column next_attempt_at timestamptz not null default now();
create index crm_webhooks_ready on public.provider_webhook_events(next_attempt_at,created_at) where processed_at is null;

-- Atomic status projection + history + callback completion. Row locks serialize
-- concurrent workers. Unmatched callbacks stay pending until acceptance is saved.
create function public.crm_apply_sent_status(p_callback text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare cb public.provider_webhook_events; msg public.communications;
 st text; at_time timestamptz; terminal boolean; current_terminal boolean; advance boolean;
begin
 select * into cb from public.provider_webhook_events where id=p_callback for update;
 if not found or cb.processed_at is not null then return; end if;
 if cb.provider<>'sms' or cb.provider_id not like 'sentdm:%' then raise exception 'Not a Sent status callback'; end if;
 select * into msg from public.communications where provider_id=cb.provider_id
  and company_id=cb.payload->>'company_id' and channel='sms' for update;
 if not found then
  update public.provider_webhook_events set next_attempt_at=now()+interval '1 minute' where id=cb.id;
  return;
 end if;
 st:=cb.payload->>'status'; at_time:=(cb.payload->>'created_at')::timestamptz;
 if st not in ('queued','routed','sent','delivered','read','failed','blocked','filtered','scheduled','cancelled') or at_time is null then
  raise exception 'Invalid Sent status';
 end if;
 terminal:=st in ('delivered','read','failed','blocked','filtered','cancelled');
 current_terminal:=coalesce(msg.provider_status in ('delivered','read','failed','blocked','filtered','cancelled'),false);
 advance:=(msg.provider_status_at is null or at_time>msg.provider_status_at or
   (at_time=msg.provider_status_at and terminal and (not current_terminal or (msg.provider_status='delivered' and st='read'))))
   and (not current_terminal or (msg.provider_status='delivered' and st='read'));
 if advance then
  update public.communications set
   status=case when st='cancelled' then 'cancelled' when st in ('failed','blocked','filtered') then 'failed'
    when st in ('delivered','read') then 'delivered' else status end,
   provider_status=st, provider_status_at=at_time,
   error=case when st='cancelled' then 'Scheduled message cancelled by provider.'
    when st in ('failed','blocked','filtered') then cb.payload->>'failure_reason' else null end,
   updated_at=now() where id=msg.id;
 end if;
 insert into public.communication_events(company_id,customer_id,quote_id,invoice_id,job_id,channel,status,event_type,metadata,dedupe_key)
 values(msg.company_id,msg.customer_id,msg.quote_id,msg.invoice_id,msg.job_id,'sms',st,'sms.'||st,
  jsonb_build_object('message_id',msg.id,'provider_id',cb.provider_id),cb.id)
 on conflict(dedupe_key) do nothing;
 update public.provider_webhook_events set processed_at=now() where id=cb.id;
end $$;
revoke all on function public.crm_apply_sent_status(text) from public,anon,authenticated;
grant execute on function public.crm_apply_sent_status(text) to service_role;

-- Immediate suppression closes the interval between receipt and asynchronous
-- customer matching, including when the worker is paused or backlogged.
create function public.crm_store_sent_callback(p_id text,p_provider text,p_provider_id text,p_payload jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_provider not in ('sms','sentdm-inbound') or p_payload->>'company_id' is null then
  raise exception 'Invalid Sent callback';
 end if;
 insert into public.provider_webhook_events(id,provider,provider_id,payload)
 values(p_id,p_provider,p_provider_id,p_payload) on conflict(id) do nothing;
 if p_provider='sentdm-inbound' and p_payload->'opt_out'='true'::jsonb then
  insert into public.sms_phone_suppressions(company_id,phone)
   values(p_payload->>'company_id',p_payload->>'from') on conflict(company_id,phone) do nothing;
 end if;
end $$;
revoke all on function public.crm_store_sent_callback(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_store_sent_callback(text,text,text,jsonb) to service_role;
