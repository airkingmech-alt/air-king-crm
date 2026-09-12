begin;

-- Air King Marketing Center. This migration is additive: it reuses the existing
-- customers, templates, communications, events, preferences, and worker model.
create table public.marketing_audiences (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  name text not null, description text not null default '',
  mode text not null default 'dynamic' check (mode in ('static','dynamic')),
  filters jsonb not null default '[]' check (jsonb_typeof(filters) = 'array'),
  exclusions jsonb not null default '[]' check (jsonb_typeof(exclusions) = 'array'),
  active boolean not null default true, archived boolean not null default false,
  estimated_count integer not null default 0 check (estimated_count >= 0), evaluated_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  audience_id uuid references public.marketing_audiences(id), name text not null,
  description text not null default '', goal text not null default 'custom',
  campaign_type text not null default 'one_time' check (campaign_type in ('one_time','scheduled','recurring','sequence')),
  status text not null default 'draft' check (status in ('draft','scheduled','queued','sending','active','paused','completed','stopped','failed','archived')),
  channels text[] not null default array['email']::text[], starts_at timestamptz,
  recurrence jsonb not null default '{}', settings jsonb not null default '{}',
  revision integer not null default 1,
  enabled boolean not null default false, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (cardinality(channels) between 1 and 2), check (channels <@ array['email','sms']::text[])
);

create table public.marketing_campaign_steps (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  action text not null check (action in ('email','sms','wait','activity')),
  template_id uuid references public.message_templates(id),
  delay_minutes integer not null default 0 check (delay_minutes between 0 and 525600),
  conditions jsonb not null default '[]' check (jsonb_typeof(conditions) = 'array'),
  content_snapshot jsonb not null default '{}', created_at timestamptz not null default now(),
  unique (campaign_id, sort_order)
);

create table public.marketing_campaign_runs (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  campaign_id uuid not null references public.marketing_campaigns(id),
  snapshot jsonb not null default '{}', launch_key uuid,
  status text not null default 'queued' check (status in ('queued','evaluating','sending','paused','completed','stopped','failed')),
  scheduled_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
  lease_until timestamptz, claim_token uuid, audience_count integer not null default 0,
  eligible_count integer not null default 0, excluded_count integer not null default 0,
  sent_count integer not null default 0, failed_count integer not null default 0,
  estimated_cost_cents integer not null default 0, actual_cost_cents integer not null default 0,
  error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  run_id uuid not null references public.marketing_campaign_runs(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id),
  step_id uuid references public.marketing_campaign_steps(id), customer_id text not null references public.customers(id),
  channel text not null check (channel in ('email','sms')), recipient text,
  eligibility text not null default 'eligible' check (eligibility in ('eligible','excluded','queued','sent','failed','cancelled')),
  exclusion_reason text, communication_id uuid references public.communications(id), provider_status text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (run_id, customer_id, step_id, channel)
);
create unique index marketing_run_launch_key on public.marketing_campaign_runs(company_id,launch_key) where launch_key is not null;
create unique index marketing_active_run on public.marketing_campaign_runs(campaign_id) where status in ('queued','evaluating','sending','paused');
create unique index marketing_recipient_destination on public.marketing_campaign_recipients(run_id,step_id,channel,recipient) where eligibility <> 'excluded';

create table public.communication_consent_events (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  customer_id text not null references public.customers(id), channel text not null check (channel in ('email','sms')),
  category text not null check (category in ('transactional','marketing')),
  action text not null check (action in ('opt_in','opt_out','suppressed','unsuppressed')),
  source text not null, disclosure_version text, evidence jsonb not null default '{}', actor_id uuid,
  occurred_at timestamptz not null default now(), created_at timestamptz not null default now()
);

create table public.marketing_attributions (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  campaign_id uuid not null references public.marketing_campaigns(id), communication_id uuid references public.communications(id),
  customer_id text not null references public.customers(id), job_id text not null references public.work_orders(id),
  rule text not null default 'last_touch_30d', value_cents bigint not null default 0 check (value_cents >= 0),
  revenue_status text not null default 'upcoming' check (revenue_status in ('upcoming','completed','cancelled')),
  attributed_at timestamptz not null default now(), created_at timestamptz not null default now(), unique (job_id, rule)
);

alter table public.communications add column campaign_id uuid references public.marketing_campaigns(id),
  add column campaign_run_id uuid references public.marketing_campaign_runs(id);
alter table public.communication_events add column campaign_id uuid references public.marketing_campaigns(id),
  add column campaign_run_id uuid references public.marketing_campaign_runs(id);

create index marketing_audiences_company on public.marketing_audiences(company_id, archived, updated_at desc);
create index marketing_campaigns_company on public.marketing_campaigns(company_id, status, updated_at desc);
create index marketing_campaigns_due on public.marketing_campaigns(starts_at) where enabled and status in ('scheduled','active');
create index marketing_steps_campaign on public.marketing_campaign_steps(campaign_id, sort_order);
create index marketing_runs_due on public.marketing_campaign_runs(scheduled_at) where status in ('queued','sending');
create index marketing_recipients_run on public.marketing_campaign_recipients(run_id, eligibility);
create index marketing_recipients_customer on public.marketing_campaign_recipients(company_id, customer_id, created_at desc);
create index communication_consent_customer on public.communication_consent_events(company_id, customer_id, occurred_at desc);
create index marketing_attributions_campaign on public.marketing_attributions(company_id, campaign_id, attributed_at desc);
create index communications_campaign on public.communications(company_id, campaign_id, created_at desc) where campaign_id is not null;

do $$ declare t text; begin
  foreach t in array array['marketing_audiences','marketing_campaigns','marketing_campaign_steps','marketing_campaign_runs','marketing_campaign_recipients','communication_consent_events','marketing_attributions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy company_read on public.%I for select to authenticated using (company_id = (select public.get_my_company_id()))', t);
  end loop;
end $$;

create function public.crm_claim_marketing_runs() returns setof public.marketing_campaign_runs
language sql security invoker set search_path=public as $$
  update public.marketing_campaign_runs set status='evaluating', lease_until=now()+interval '5 minutes',
    claim_token=gen_random_uuid(), started_at=coalesce(started_at, now()), updated_at=now()
  where id in (
    select r.id from public.marketing_campaign_runs r
    join public.marketing_campaigns c on c.id=r.campaign_id and c.company_id=r.company_id
    where ((r.status='queued' and r.scheduled_at<=now()) or (r.status in ('evaluating','sending') and r.lease_until<now()))
      and c.enabled and c.status not in ('paused','stopped','archived')
    order by r.scheduled_at limit 5 for update of r skip locked
  ) returning *;
$$;
revoke all on function public.crm_claim_marketing_runs() from public, anon, authenticated;
grant execute on function public.crm_claim_marketing_runs() to service_role;

-- Save all draft changes together. Launched steps are immutable audit records.
create function public.crm_save_campaign(p_company text, p_actor uuid, p_id uuid, p_record jsonb, p_steps jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c marketing_campaigns; s jsonb; i integer := 0;
begin
  if not exists(select 1 from marketing_audiences where id=(p_record->>'audience_id')::uuid and company_id=p_company and active and not archived) then raise exception 'Choose an active audience'; end if;
  if p_id is not null then
    select * into c from marketing_campaigns where id=p_id and company_id=p_company for update;
    if not found or c.status<>'draft' or exists(select 1 from marketing_campaign_runs where campaign_id=p_id) then raise exception 'Only unlaunched drafts can be edited; duplicate this campaign instead'; end if;
  else
    insert into marketing_campaigns(company_id,name,created_by) values(p_company,p_record->>'name',p_actor) returning * into c;
  end if;
  update marketing_campaigns set name=p_record->>'name',description=p_record->>'description',goal=p_record->>'goal',
    audience_id=(p_record->>'audience_id')::uuid,campaign_type=p_record->>'campaign_type',
    channels=array(select jsonb_array_elements_text(p_record->'channels')),starts_at=(p_record->>'starts_at')::timestamptz,
    recurrence=p_record->'recurrence',settings=p_record->'settings',revision=revision+1,updated_at=now()
    where id=c.id returning * into c;
  delete from marketing_campaign_steps where campaign_id=c.id;
  for s in select * from jsonb_array_elements(p_steps) loop
    if s->>'action' in ('email','sms') and not exists(select 1 from message_templates where id=(s->>'template_id')::uuid and company_id=p_company and channel=s->>'action' and category='marketing' and active and not archived) then raise exception 'Choose an active marketing template'; end if;
    insert into marketing_campaign_steps(company_id,campaign_id,sort_order,action,template_id,delay_minutes,conditions,content_snapshot)
    values(p_company,c.id,i,s->>'action',(s->>'template_id')::uuid,(s->>'delay_minutes')::integer,s->'conditions',coalesce(s->'content_snapshot','{}'));
    i := i+1;
  end loop;
  return to_jsonb(c);
end $$;

-- A locked campaign row and a unique request key make double clicks/retries harmless.
create function public.crm_launch_campaign(p_company text,p_id uuid,p_key uuid,p_revision integer,p_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c marketing_campaigns; r marketing_campaign_runs;
begin
  select * into c from marketing_campaigns where id=p_id and company_id=p_company for update;
  if not found then raise exception 'Campaign not found'; end if;
  select * into r from marketing_campaign_runs where company_id=p_company and launch_key=p_key;
  if found then
    if r.campaign_id<>p_id then raise exception 'Launch key already used'; end if;
    return to_jsonb(r);
  end if;
  if c.status<>'draft' or c.revision<>p_revision then raise exception 'Campaign changed or was already launched. Refresh before continuing'; end if;
  if jsonb_array_length(coalesce(p_snapshot->'people','[]'))=0 then raise exception 'No eligible audience'; end if;
  insert into marketing_campaign_runs(company_id,campaign_id,scheduled_at,launch_key,snapshot)
    values(p_company,p_id,coalesce(c.starts_at,now()),p_key,p_snapshot) returning * into r;
  update marketing_campaigns set enabled=true,status=case when r.scheduled_at>now() then 'scheduled' else 'queued' end,updated_at=now() where id=p_id;
  return to_jsonb(r);
end $$;

create function public.crm_control_campaign(p_company text,p_id uuid,p_action text)
returns void language plpgsql security invoker set search_path=public as $$
declare c marketing_campaigns;
begin
  select * into c from marketing_campaigns where company_id=p_company and id=p_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if p_action='pause' and c.status in ('queued','scheduled','sending','active') then
    update marketing_campaigns set enabled=false,status='paused',updated_at=now() where id=p_id;
  elsif p_action='resume' and c.status='paused' then
    update marketing_campaigns set enabled=true,status='active',updated_at=now() where id=p_id;
  elsif p_action='stop' and c.status not in ('archived','completed') then
    update marketing_campaigns set enabled=false,status='stopped',updated_at=now() where id=p_id;
    update marketing_campaign_runs set status='stopped',lease_until=null,completed_at=now() where campaign_id=p_id and status in ('queued','evaluating','sending','paused');
    update communications set status='cancelled',error='Campaign stopped',updated_at=now() where campaign_id=p_id and status='pending';
  elsif p_action='archive' and c.status in ('draft','completed','stopped','failed') then
    update marketing_campaigns set enabled=false,status='archived',updated_at=now() where id=p_id;
  else raise exception 'This campaign cannot be changed from its current status'; end if;
end $$;

-- Audit preference changes regardless of whether they came from staff, unsubscribe,
-- or a verified provider callback. Unchanged saves do not manufacture opt-in events.
create function crm_private.capture_marketing_consent() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare field text; old_data jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end; new_data jsonb := to_jsonb(new);
begin
  foreach field in array array['email_marketing','sms_marketing','email_suppressed','sms_stopped'] loop
    if old_data->field is distinct from new_data->field then
      insert into communication_consent_events(company_id,customer_id,channel,category,action,source,evidence)
      values(new.company_id,new.customer_id,case when field like 'email_%' then 'email' else 'sms' end,'marketing',
        case when field in ('email_suppressed','sms_stopped') then case when (new_data->>field)::boolean then 'suppressed' else 'unsuppressed' end
        else case when (new_data->>field)::boolean then 'opt_in' else 'opt_out' end end,
        coalesce(new.consent_source,'Preference change'),jsonb_build_object('field',field,'previous',old_data->field,'current',new_data->field));
    end if;
  end loop;
  return new;
end $$;
create trigger marketing_consent_audit after insert or update on customer_communication_preferences for each row execute function crm_private.capture_marketing_consent();

create function public.crm_finish_campaign_tick(p_id uuid,p_token uuid,p_remaining boolean)
returns void language plpgsql security invoker set search_path=public as $$
declare r marketing_campaign_runs; c marketing_campaigns; pending integer; next_date timestamptz; snap jsonb;
begin
  select * into r from marketing_campaign_runs where id=p_id and claim_token=p_token and status='evaluating' for update;
  if not found then return; end if;
  select * into c from marketing_campaigns where id=r.campaign_id for update;
  if c.status in ('stopped','archived') then return; end if;
  update marketing_campaign_recipients cr set
    eligibility=case when m.status in ('sent','delivered') then 'sent' when m.status in ('failed','unknown','bounced') then 'failed' when m.status='cancelled' then 'cancelled' else 'queued' end,
    provider_status=m.provider_status,exclusion_reason=m.error,updated_at=now()
    from communications m where cr.run_id=r.id and cr.communication_id=m.id;
  select count(*) into pending from communications where campaign_run_id=r.id and status in ('pending','sending');
  update marketing_campaign_runs set
    audience_count=jsonb_array_length(snapshot->'people'),
    eligible_count=(select count(*) from marketing_campaign_recipients where run_id=r.id and eligibility<>'excluded'),
    excluded_count=(select count(*) from marketing_campaign_recipients where run_id=r.id and eligibility='excluded'),
    sent_count=(select count(*) from marketing_campaign_recipients where run_id=r.id and eligibility='sent'),
    failed_count=(select count(*) from marketing_campaign_recipients where run_id=r.id and eligibility='failed'),
    status=case when p_remaining or pending>0 then 'sending' else 'completed' end,
    lease_until=case when p_remaining or pending>0 then now()+interval '30 seconds' else null end,
    completed_at=case when p_remaining or pending>0 then null else now() end,updated_at=now() where id=r.id;
  if p_remaining or pending>0 then
    update marketing_campaigns set status='sending',updated_at=now() where id=c.id and enabled;
    return;
  end if;
  if c.campaign_type='recurring' then
    next_date:=greatest(r.scheduled_at+make_interval(days=>greatest(7,coalesce((c.recurrence->>'every_days')::integer,30))),now()+interval '1 minute');
    snap:=r.snapshot;
    if snap->'audience'->>'mode'='dynamic' then snap:=snap-'people'; end if;
    insert into marketing_campaign_runs(company_id,campaign_id,scheduled_at,snapshot) values(r.company_id,c.id,next_date,snap);
    update marketing_campaigns set status=case when enabled then 'active' else 'paused' end,updated_at=now() where id=c.id;
  else
    update marketing_campaigns set enabled=false,status='completed',updated_at=now() where id=c.id;
  end if;
end $$;
revoke all on function public.crm_finish_campaign_tick(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.crm_finish_campaign_tick(uuid,uuid,boolean) to service_role;

-- Serialize campaign delivery for a customer/destination, without changing the
-- transactional outbox contract. Locks are transaction-scoped; sending state
-- keeps another worker from racing the provider request after commit.
create or replace function public.crm_claim_message(p_id uuid)
returns setof public.communications language plpgsql security invoker set search_path=public as $$
declare m communications; c marketing_campaigns;
begin
  select * into m from communications where id=p_id;
  if not found or m.status<>'pending' or m.scheduled_at>now() then return; end if;
  if m.campaign_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(m.company_id||':'||m.customer_id,0));
    perform pg_advisory_xact_lock(hashtextextended(m.company_id||':'||m.channel||':'||lower(m.recipient),1));
    select * into c from marketing_campaigns where id=m.campaign_id and company_id=m.company_id;
    if not found or not c.enabled or c.status in ('paused','stopped','archived','failed','completed') then return; end if;
    if exists(select 1 from communications where company_id=m.company_id and campaign_id is not null and id<>p_id and status='sending' and
      (customer_id=m.customer_id or (channel=m.channel and lower(recipient)=lower(m.recipient)))) then return; end if;
  end if;
  return query update communications set status='sending',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()
    where id=p_id and status='pending' and scheduled_at<=now() returning *;
end $$;

revoke all on function public.crm_save_campaign(text,uuid,uuid,jsonb,jsonb), public.crm_launch_campaign(text,uuid,uuid,integer,jsonb), public.crm_control_campaign(text,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_save_campaign(text,uuid,uuid,jsonb,jsonb), public.crm_launch_campaign(text,uuid,uuid,integer,jsonb), public.crm_control_campaign(text,uuid,text) to service_role;

commit;
