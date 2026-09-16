-- Additive: existing customer, scheduling, and invoice records are untouched.
create table public.employee_time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  clock_in timestamptz not null,
  clock_out timestamptz,
  notes text not null default '' check (length(notes) <= 2000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (isfinite(clock_in) and (clock_out is null or (isfinite(clock_out) and clock_out > clock_in)))
);
create unique index employee_time_one_open on public.employee_time_entries(company_id, employee_id) where clock_out is null;
create index employee_time_range on public.employee_time_entries(company_id, clock_in desc);
create index employee_time_person on public.employee_time_entries(employee_id, clock_in desc);

create table public.employee_time_events (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  entry_id uuid not null references public.employee_time_entries(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('clock_in','clock_out','create','edit')),
  reason text not null default '',
  before_data jsonb,
  after_data jsonb not null,
  request_key uuid not null,
  request_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (company_id, actor_id, request_key)
);
create index employee_time_event_entry on public.employee_time_events(company_id, entry_id, created_at);
create index employee_time_event_actor on public.employee_time_events(actor_id);

-- API-only records: no browser role can read or write another employee's hours.
alter table public.employee_time_entries enable row level security;
alter table public.employee_time_events enable row level security;
revoke all on public.employee_time_entries, public.employee_time_events from public, anon, authenticated, service_role;
grant select, insert, update on public.employee_time_entries to service_role;
grant select, insert on public.employee_time_events to service_role;

create function public.time_clock_write(p_actor uuid, p_action text, p_request uuid, p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  entry public.employee_time_entries%rowtype;
  old_data jsonb;
  prior public.employee_time_events%rowtype;
  employee uuid;
  start_time timestamptz;
  end_time timestamptz;
  stamp timestamptz;
  reason_text text := btrim(coalesce(p_data->>'reason',''));
  manager boolean;
  request_doc jsonb := jsonb_build_object('action',p_action,'data',p_data);
begin
  select * into actor from public.profiles where id = p_actor;
  if not found or actor.company_id is null or btrim(actor.company_id) = '' or actor.role not in ('owner','admin','technician','dispatcher') then
    raise exception 'Staff access required.' using errcode = '42501';
  end if;
  if actor.role <> 'owner' and actor.permissions->'time_clock' = 'false'::jsonb then
    raise exception 'Time Clock access is disabled. Ask the owner.' using errcode = '42501';
  end if;
  manager := actor.role in ('owner','admin');
  if p_request is null or p_action not in ('clock_in','clock_out','create','edit') or p_action is null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Invalid time clock request.' using errcode = '22023';
  end if;
  -- Serialize retries by the actor before selecting the employee. This also
  -- prevents a reused request key from changing two different employees.
  perform pg_advisory_xact_lock(hashtextextended('time-clock-actor:' || p_actor::text, 0));
  select * into prior from public.employee_time_events
    where company_id = actor.company_id and actor_id = p_actor and request_key = p_request;
  if found then
    if prior.request_data <> request_doc then raise exception 'This request was already used. Refresh and try again.' using errcode = '22023'; end if;
    return prior.after_data;
  end if;

  if p_action in ('edit','clock_out') then
    select * into entry from public.employee_time_entries where id = (p_data->>'id')::uuid and company_id = actor.company_id;
    if not found then raise exception 'Time entry not found.' using errcode = 'P0002'; end if;
    employee := entry.employee_id;
  elsif p_action = 'create' then employee := coalesce((p_data->>'employee_id')::uuid, p_actor);
  else employee := p_actor;
  end if;
  if (not manager and employee <> p_actor) or (p_action = 'clock_out' and employee <> p_actor) then
    raise exception 'You can only change your own time.' using errcode = '42501';
  end if;
  if p_action in ('edit','create') and not manager and actor.permissions->'time_clock_edit_own' = 'false'::jsonb then
    raise exception 'Ask an owner or admin to correct this time entry.' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = employee and company_id = actor.company_id;
  if not found or target.role not in ('owner','admin','technician','dispatcher') then raise exception 'Employee not found.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('time-clock-employee:' || employee::text, 0));
  stamp := clock_timestamp();
  if p_action in ('edit','clock_out') then
    select * into entry from public.employee_time_entries where id = entry.id for update;
    if p_data->>'version' is null or (p_data->>'version')::integer <> entry.version then
      raise exception 'This entry changed. Refresh and review the latest times.' using errcode = '40001';
    end if;
    old_data := to_jsonb(entry);
  end if;
  if p_action = 'clock_in' then
    select * into entry from public.employee_time_entries where company_id = actor.company_id and employee_id = employee and clock_out is null;
    if found then raise exception 'You are already clocked in. Refresh to see your shift.' using errcode = '40001'; end if;
    start_time := stamp;
  elsif p_action = 'clock_out' then
    if entry.clock_out is not null then raise exception 'This shift is already clocked out.' using errcode = '40001'; end if;
    start_time := entry.clock_in;
    end_time := stamp;
  else
    if length(reason_text) < 3 or length(reason_text) > 500 then raise exception 'Add a reason for this correction (3–500 characters).' using errcode = '22023'; end if;
    start_time := (p_data->>'clock_in')::timestamptz;
    end_time := (p_data->>'clock_out')::timestamptz;
    if p_action = 'create' and end_time is null then raise exception 'Add both times for a missed shift.' using errcode = '22023'; end if;
    if p_action = 'edit' and entry.clock_out is not null and end_time is null then raise exception 'A completed shift must have a clock-out time.' using errcode = '22023'; end if;
  end if;
  if start_time is null or not isfinite(start_time) or start_time > stamp or
     (end_time is not null and (not isfinite(end_time) or end_time <= start_time or end_time > stamp)) then
    raise exception 'Use past times, with clock out after clock in.' using errcode = '22023';
  end if;
  if exists(select 1 from public.employee_time_entries t
    where t.company_id = actor.company_id and t.employee_id = employee
      and (p_action not in ('edit','clock_out') or t.id <> entry.id)
      and t.clock_in < coalesce(end_time,'infinity'::timestamptz)
      and coalesce(t.clock_out,'infinity'::timestamptz) > start_time) then
    raise exception 'These times overlap another shift. Correct that entry first.' using errcode = '22023';
  end if;
  if p_action in ('clock_in','create') then
    insert into public.employee_time_entries(company_id,employee_id,clock_in,clock_out,notes)
    values(actor.company_id,employee,start_time,end_time,coalesce(p_data->>'notes','')) returning * into entry;
  else
    update public.employee_time_entries set clock_in = start_time, clock_out = end_time,
      notes = case when p_action = 'edit' then coalesce(p_data->>'notes','') else notes end,
      version = version + 1, updated_at = stamp where id = entry.id returning * into entry;
  end if;
  insert into public.employee_time_events(company_id,entry_id,actor_id,action,reason,before_data,after_data,request_key,request_data)
  values(actor.company_id,entry.id,p_actor,p_action,reason_text,old_data,to_jsonb(entry),p_request,request_doc);
  return to_jsonb(entry);
end;
$$;
revoke all on function public.time_clock_write(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.time_clock_write(uuid,text,uuid,jsonb) to service_role;
