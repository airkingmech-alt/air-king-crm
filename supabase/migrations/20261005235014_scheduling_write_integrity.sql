set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- No appointments are inferred, repaired or backfilled. This small private mutex
-- serializes all future schedule writes, including direct SQL and legacy RPCs.
create table crm_private.schedule_write_locks (
 company_id text primary key,
 revision bigint not null default 1
);
alter table crm_private.schedule_write_locks enable row level security;
revoke all on crm_private.schedule_write_locks from public,anon,authenticated;

create function crm_private.lock_company_schedule(p_company text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if p_company is null then raise exception 'Company is required'; end if;
 insert into crm_private.schedule_write_locks(company_id) values(p_company)
 on conflict(company_id) do update set revision=crm_private.schedule_write_locks.revision+1;
end $$;
revoke all on function crm_private.lock_company_schedule(text) from public,anon,authenticated;
grant usage on schema crm_private to service_role;
grant execute on function crm_private.lock_company_schedule(text) to service_role;

create function crm_private.appointment_start(p_data jsonb) returns timestamp
language plpgsql immutable security invoker set search_path='' as $$
begin
 if coalesce(p_data->>'scheduledDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_data->>'scheduledTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$' then return null; end if;
 return (p_data->>'scheduledDate')::date+(p_data->>'scheduledTime')::time;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;
revoke all on function crm_private.appointment_start(jsonb) from public,anon,authenticated;

-- Used only as an uncertainty boundary when legacy records name a date but
-- omit a valid time. It never writes or invents an appointment start time.
create function crm_private.appointment_day(p_data jsonb) returns date
language plpgsql immutable security invoker set search_path='' as $$
begin
 if coalesce(p_data->>'scheduledDate','') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
 return (p_data->>'scheduledDate')::date;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;
revoke all on function crm_private.appointment_day(jsonb) from public,anon,authenticated;

create function crm_private.appointment_duration(p_data jsonb) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare minutes numeric;
begin
 minutes:=coalesce(nullif((p_data->>'durationMinutes')::numeric,0),nullif((p_data->>'laborHours')::numeric*60,0),60);
 if minutes between 15 and 1440 then return minutes; end if;
 return 60;
exception when invalid_text_representation or numeric_value_out_of_range then return 60;
end $$;
revoke all on function crm_private.appointment_duration(jsonb) from public,anon,authenticated;

-- Match the app's JSON truthiness for old records as well. False/0/empty-string
-- tombstones remain live; new writes are rejected unless they use a real timestamp.
create function crm_private.appointment_active(p_data jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(p_data->>'status','') not in ('Completed','Cancelled','Unscheduled','Needs Follow-up')
  and coalesce(p_data->'deletedAt','null'::jsonb) in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
$$;
revoke all on function crm_private.appointment_active(jsonb) from public,anon,authenticated;

-- This trigger needs a complete company schedule and team lookup despite the
-- caller's self-only profile RLS. It is private, not directly executable, and
-- never changes row ownership or permissions. The actual DML retains its RLS.
create function crm_private.guard_work_order_schedule() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare
 active boolean; was_active boolean; schedule_changed boolean; starts timestamp; minutes numeric;
 person public.profiles%rowtype; matches integer; overlap boolean;
 schedule_keys text[]:=array['scheduledDate','scheduledTime','durationMinutes','laborHours','technician','technicianId'];
begin
 if tg_op='INSERT' or new.data->'deletedAt' is distinct from old.data->'deletedAt' then
  if new.data->'deletedAt' is not null and new.data->'deletedAt'<>'null'::jsonb then
   if jsonb_typeof(new.data->'deletedAt')<>'string' or coalesce(new.data->>'deletedAt','') !~ '^\d{4}-\d{2}-\d{2}T' then
    raise exception 'Invalid appointment deletion marker';
   end if;
   perform (new.data->>'deletedAt')::timestamptz;
  end if;
 end if;
 if tg_op='INSERT' or new.data->>'status' is distinct from old.data->>'status' then
  if new.data->>'status' is null or new.data->>'status' not in ('Unscheduled','Scheduled','Dispatched','In Progress','Completed','Cancelled','Needs Follow-up') then
   raise exception 'Choose a valid job status';
  end if;
 end if;
 active:=crm_private.appointment_active(new.data);
 if tg_op='UPDATE' then
  was_active:=crm_private.appointment_active(old.data);
  schedule_changed:=exists(select 1 from unnest(schedule_keys) k where new.data->k is distinct from old.data->k);
  if new.company_id is not distinct from old.company_id and new.id=old.id
     and active=was_active and not schedule_changed then
   return new; -- Preserve unrelated edits to legacy appointments exactly as saved.
  end if;
 end if;
 if new.data->>'status' is null or new.data->>'status' not in ('Unscheduled','Scheduled','Dispatched','In Progress','Completed','Cancelled','Needs Follow-up') then
  raise exception 'Choose a valid job status';
 end if;
 -- A row UPDATE, rather than only an advisory lock, also forces serialization
 -- failure for a stale REPEATABLE READ/SERIALIZABLE snapshot. At READ COMMITTED,
 -- VOLATILE PL/pgSQL queries below obtain a fresh snapshot AFTER this wait.
 -- https://www.postgresql.org/docs/current/xfunc-volatility.html
 perform crm_private.lock_company_schedule(new.company_id);
 -- Releasing/cancelling a booking must not require repairing old appointment data.
 if tg_op='UPDATE' and not active and was_active and not schedule_changed then return new; end if;
 if tg_op='UPDATE' and old.data->>'status' in ('Completed','Cancelled')
    and schedule_changed then
  raise exception 'Closed jobs cannot be moved';
 end if;
 starts:=crm_private.appointment_start(new.data);
 if active or coalesce(new.data->>'scheduledDate','')<>'' or coalesce(new.data->>'scheduledTime','')<>'' then
  if starts is null then raise exception 'Choose a valid appointment date and time'; end if;
 end if;
 if new.data->>'durationMinutes' is not null and
    (jsonb_typeof(new.data->'durationMinutes')<>'number' or (new.data->>'durationMinutes')::numeric not between 15 and 1440
     or trunc((new.data->>'durationMinutes')::numeric)<>(new.data->>'durationMinutes')::numeric) then
  raise exception 'Choose a duration between 15 and 1440 whole minutes';
 end if;
 if coalesce(trim(new.data->>'technicianId'),'')<>'' then
  select * into person from public.profiles where id::text=new.data->>'technicianId'
    and company_id=new.company_id and role in ('owner','admin','technician','dispatcher') and coalesce(trim(full_name),'')<>'';
  if not found then raise exception 'Choose an active team member'; end if;
 elsif coalesce(trim(new.data->>'technician'),'')<>'' then
  select count(*) into matches from public.profiles where company_id=new.company_id
   and role in ('owner','admin','technician','dispatcher') and lower(trim(full_name))=lower(trim(new.data->>'technician'));
  if matches<>1 then raise exception 'Choose a current team member from the list; duplicate names require a team member ID'; end if;
  select * into person from public.profiles where company_id=new.company_id
   and role in ('owner','admin','technician','dispatcher') and lower(trim(full_name))=lower(trim(new.data->>'technician'));
 else
  return new; -- A legitimate unassigned draft/appointment does not reserve a technician.
 end if;
 -- Validation does not silently rewrite generic saves. Keeping their exact JSON
 -- preserves crm_save_records/Crown Care idempotent retries and prior snapshots.
 if coalesce(trim(new.data->>'technicianId'),'')<>''
    and new.data->>'technician' is distinct from person.full_name then
  raise exception 'Choose the current team member name for this technician ID';
 end if;
 if not active then return new; end if;
 minutes:=crm_private.appointment_duration(new.data);
 -- Unknown times on a known date cannot be assumed free or assigned 09:00.
 -- Require explicit reconciliation even when the normal overlap override is set.
 if exists(select 1 from public.work_orders other
  where other.company_id=new.company_id and other.id<>new.id and crm_private.appointment_active(other.data)
   and (case when coalesce(trim(other.data->>'technicianId'),'')<>'' then other.data->>'technicianId'=person.id::text
        else lower(trim(other.data->>'technician'))=lower(trim(person.full_name)) end)
   and crm_private.appointment_start(other.data) is null
   and starts < crm_private.appointment_day(other.data)::timestamp+interval '1 day'
   and starts+interval '1 minute'*minutes > crm_private.appointment_day(other.data)::timestamp) then
  raise exception using errcode='23P01',message='This technician has a job with incomplete appointment details on this date. Review that job date and time before saving.';
 end if;
 select exists(select 1 from public.work_orders other
  where other.company_id=new.company_id and other.id<>new.id and crm_private.appointment_active(other.data)
   and (case when coalesce(trim(other.data->>'technicianId'),'')<>'' then other.data->>'technicianId'=person.id::text
        else lower(trim(other.data->>'technician'))=lower(trim(person.full_name)) end)
   and starts < crm_private.appointment_start(other.data)+interval '1 minute'*crm_private.appointment_duration(other.data)
   and starts+interval '1 minute'*minutes > crm_private.appointment_start(other.data)) into overlap;
 if overlap and not coalesce((current_setting('role',true)='service_role'
   and current_setting('crm.schedule_conflict_override',true)=new.id),false) then
  raise exception using errcode='23P01',message='This technician already has an overlapping job. Review the conflict before saving.';
 end if;
 return new;
end $$;
revoke all on function crm_private.guard_work_order_schedule() from public,anon,authenticated;
-- Sort before Crown Care sync so an invalid appointment never claims a seasonal slot.
create trigger a_work_order_schedule_guard before insert or update on public.work_orders
 for each row execute function crm_private.guard_work_order_schedule();

-- The HTTP server authenticates the bearer token before passing the actor ID.
-- Only service_role may use the override. Generic JSON writes cannot opt out.
create function public.crm_write_scheduled_work_order(p_actor_id uuid,p_company_id text,p_work_order jsonb,
 p_create boolean,p_expected_updated_at timestamptz default null,p_allow_conflict boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare actor public.profiles%rowtype; existing public.work_orders%rowtype; saved public.work_orders%rowtype; previous_override text;
begin
 if current_user<>'service_role' then raise exception 'Server scheduling access required'; end if;
 select * into actor from public.profiles where id=p_actor_id and company_id=p_company_id
  and role in ('owner','admin','technician','dispatcher');
 if not found or (actor.role<>'owner' and actor.permissions->'schedule'='false'::jsonb) then
  raise exception using errcode='42501',message='Schedule access is disabled. Ask the owner.';
 end if;
 if coalesce(trim(p_work_order->>'id'),'')='' or coalesce(trim(p_work_order->>'customerId'),'')='' then raise exception 'Invalid work order identity'; end if;
 perform crm_private.lock_company_schedule(p_company_id);
 select * into existing from public.work_orders where id=p_work_order->>'id' and company_id=p_company_id for update;
 if p_create then
  if p_allow_conflict then raise exception 'New jobs cannot override schedule conflicts'; end if;
  if p_work_order->>'quoteId' is not null then raise exception 'Use quote conversion to create a job linked to a quote'; end if;
  if p_work_order->>'membershipId' is not null or p_work_order->>'membershipSeason' is not null then raise exception 'Use Crown Care booking for a seasonal visit'; end if;
  if actor.role<>'owner' and actor.permissions->'customers'='false'::jsonb then raise exception using errcode='42501',message='Customer access is disabled. Ask the owner.'; end if;
  if not exists(select 1 from public.customers where id=p_work_order->>'customerId' and company_id=p_company_id and coalesce(data->'deletedAt','null'::jsonb) in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)) then raise exception 'Customer unavailable or access restricted'; end if;
  if existing.id is not null then
   -- The HTTP server sends the same canonical payload and stable ID on retry.
   if existing.data=p_work_order then return to_jsonb(existing); end if;
   raise exception using errcode='40001',message='This job changed. Refresh and try again.';
  end if;
  insert into public.work_orders(id,company_id,customer_id,data) values(p_work_order->>'id',p_company_id,p_work_order->>'customerId',p_work_order) returning * into saved;
 else
  if existing.id is null or coalesce(existing.data->'deletedAt','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then raise exception 'Record not found'; end if;
  if existing.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='This job changed. Refresh and try again.'; end if;
  if existing.data->>'status' in ('Completed','Cancelled') then raise exception 'Closed jobs cannot be moved'; end if;
  if existing.data->>'membershipId' is not null and actor.role<>'owner' and actor.permissions->'memberships'='false'::jsonb then raise exception using errcode='42501',message='Crown Care access is disabled. Ask the owner.'; end if;
  if p_work_order->>'customerId' is distinct from existing.customer_id then raise exception 'Customer cannot be reassigned'; end if;
  previous_override:=current_setting('crm.schedule_conflict_override',true);
  perform set_config('crm.schedule_conflict_override',case when p_allow_conflict then existing.id else '' end,true);
  update public.work_orders set data=p_work_order,updated_at=clock_timestamp() where id=existing.id and company_id=p_company_id returning * into saved;
  perform set_config('crm.schedule_conflict_override',coalesce(previous_override,''),true);
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.crm_write_scheduled_work_order(uuid,text,jsonb,boolean,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.crm_write_scheduled_work_order(uuid,text,jsonb,boolean,timestamptz,boolean) to service_role;
