-- Additive inventory foundation. All writes go through server-verified RPCs.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  name text not null check(length(trim(name)) between 1 and 200),
  sku text not null check(length(trim(sku)) between 1 and 100),
  category text not null default 'Miscellaneous',
  serialized boolean not null default false,
  tracked boolean not null default true,
  active boolean not null default true,
  cost_cents bigint not null default 0 check(cost_cents>=0),
  sale_cents bigint not null default 0 check(sale_cents>=0),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,sku)
);
create table public.inventory_locations (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  name text not null check(length(trim(name)) between 1 and 200),
  type text not null check(type in ('Shop','Warehouse','Service Truck','Install Truck','Job Staging','Returns','Damaged','Other')),
  assigned_to uuid references public.profiles(id),
  active boolean not null default true,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,name)
);
create table public.inventory_stock (
  company_id text not null, item_id uuid not null, location_id uuid not null,
  on_hand bigint not null default 0 check(on_hand>=0),
  reserved bigint not null default 0 check(reserved>=0 and reserved<=on_hand),
  minimum bigint not null default 0 check(minimum>=0),
  target bigint not null default 0 check(target>=minimum),
  bin text not null default '', version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key(company_id,item_id,location_id),
  foreign key(company_id,item_id) references public.inventory_items(company_id,id),
  foreign key(company_id,location_id) references public.inventory_locations(company_id,id)
);
create table public.inventory_operations (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  request_key uuid not null, actor_id uuid not null references public.profiles(id),
  payload jsonb not null, created_at timestamptz not null default now(),
  unique(company_id,request_key), unique(company_id,id)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  operation_id uuid not null, item_id uuid not null, location_id uuid not null,
  quantity_units bigint not null check(quantity_units<>0),
  kind text not null check(kind in ('Opening','Adjustment','Job Usage','Return','Receipt','Transfer Out','Transfer In','Count')),
  unit_cost_cents bigint not null check(unit_cost_cents>=0),
  unit_sale_cents bigint not null check(unit_sale_cents>=0),
  job_id text references public.work_orders(id),
  customer_id text references public.customers(id),
  invoice_id text references public.invoices(id),
  notes text not null,
  created_at timestamptz not null default now(),
  foreign key(company_id,operation_id) references public.inventory_operations(company_id,id),
  foreign key(company_id,item_id) references public.inventory_items(company_id,id),
  foreign key(company_id,location_id) references public.inventory_locations(company_id,id)
);
create index inventory_locations_assigned on public.inventory_locations(assigned_to);
create index inventory_stock_location on public.inventory_stock(company_id,location_id);
create index inventory_movements_history on public.inventory_movements(company_id,created_at desc);
create index inventory_movements_operation on public.inventory_movements(company_id,operation_id);
create index inventory_movements_item on public.inventory_movements(company_id,item_id,created_at desc);
create index inventory_movements_location on public.inventory_movements(company_id,location_id);
create index inventory_movements_job on public.inventory_movements(job_id);
create index inventory_movements_customer on public.inventory_movements(customer_id);
create index inventory_movements_invoice on public.inventory_movements(invoice_id);
create index inventory_operations_actor on public.inventory_operations(actor_id);

-- No direct browser access. Express checks sessions and RPCs recheck profile
-- role and company. SECURITY INVOKER avoids a privileged public function.
do $$ declare t text; begin
  foreach t in array array['inventory_items','inventory_locations','inventory_stock','inventory_operations','inventory_movements'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;

create function public.inventory_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin
  raise exception 'Inventory history is permanent. Record a correcting movement instead.';
end $$;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
for each row execute function public.inventory_immutable();
create trigger inventory_operations_immutable before update or delete on public.inventory_operations
for each row execute function public.inventory_immutable();
revoke all on function public.inventory_immutable() from public,anon,authenticated;

create function public.inventory_post(
  p_company text, p_actor uuid, p_key uuid, p_payload jsonb
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  actor public.profiles%rowtype; prior public.inventory_operations%rowtype;
  item public.inventory_items%rowtype; loc public.inventory_locations%rowtype;
  stock public.inventory_stock%rowtype; op uuid; line jsonb;
  qty bigint; kind text; job text; customer text; inv text; note text;
begin
  if p_company is null or p_actor is null or p_key is null then raise exception 'Missing operation identity'; end if;
  select * into actor from public.profiles where id=p_actor and company_id=p_company;
  if not found or actor.role not in ('owner','admin','technician','dispatcher') then raise exception 'Staff access required'; end if;
  -- Serializes changes for one small-company ledger, including empty stock rows.
  -- The transaction-scoped lock is shared by every inventory mutation RPC.
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_company,0));
  select * into prior from public.inventory_operations where company_id=p_company and request_key=p_key;
  if found then
    if prior.actor_id<>p_actor or prior.payload<>p_payload then raise exception 'Request key was reused with different details'; end if;
    return prior.id;
  end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' then raise exception 'Movement lines required'; end if;
  if jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception 'Enter 1 to 200 movement lines'; end if;
  insert into public.inventory_operations(company_id,request_key,actor_id,payload)
    values(p_company,p_key,p_actor,p_payload) returning id into op;
  for line in select value from jsonb_array_elements(p_payload->'lines') loop
    if coalesce(line->>'quantity_units','') !~ '^-?[0-9]+$' then raise exception 'Invalid quantity'; end if;
    qty := (line->>'quantity_units')::bigint;
    if qty=0 or abs(qty::numeric)>9007199254740991 then raise exception 'Invalid quantity'; end if;
    kind:=line->>'kind'; note:=trim(coalesce(line->>'notes',''));
    if length(note) not between 1 and 1000 then raise exception 'An audit note is required'; end if;
    -- Workflow-specific receipt/transfer/count RPCs will use their own controlled posting paths.
    if kind is null or kind not in ('Opening','Adjustment','Job Usage','Return') then raise exception 'Unsupported direct movement'; end if;
    if kind='Job Usage' and qty>0 then raise exception 'Usage must reduce stock'; end if;
    if kind in ('Opening','Return') and qty<0 then raise exception 'This movement must increase stock'; end if;
    select * into item from public.inventory_items where company_id=p_company and id=(line->>'item_id')::uuid and active;
    if not found or not item.tracked then raise exception 'Tracked item not found'; end if;
    if item.serialized then raise exception 'Use the serialized equipment workflow'; end if;
    select * into loc from public.inventory_locations where company_id=p_company and id=(line->>'location_id')::uuid and active;
    if not found then raise exception 'Location not found'; end if;
    if actor.role not in ('owner','admin') then
      if actor.role<>'technician' or kind<>'Job Usage' or loc.assigned_to is distinct from p_actor then
        raise exception 'An administrator must approve this movement';
      end if;
    end if;
    job:=nullif(line->>'job_id',''); inv:=nullif(line->>'invoice_id',''); customer:=null;
    if kind='Job Usage' and job is null then raise exception 'Job required for usage'; end if;
    if job is not null then
      select customer_id into customer from public.work_orders where id=job and company_id=p_company;
      if not found then raise exception 'Job not found'; end if;
    end if;
    if inv is not null then
      if not exists(select 1 from public.invoices where id=inv and company_id=p_company
        and (customer is null or customer_id=customer)) then raise exception 'Invoice does not match the job'; end if;
    end if;
    insert into public.inventory_stock(company_id,item_id,location_id) values(p_company,item.id,loc.id) on conflict do nothing;
    select * into stock from public.inventory_stock where company_id=p_company and item_id=item.id and location_id=loc.id for update;
    if stock.on_hand::numeric+qty<stock.reserved or stock.on_hand::numeric+qty>9007199254740991 then raise exception 'Insufficient available stock or quantity too large'; end if;
    if kind='Opening' and exists(select 1 from public.inventory_movements where company_id=p_company and item_id=item.id and location_id=loc.id) then
      raise exception 'Opening stock is already recorded. Use an adjustment.';
    end if;
    update public.inventory_stock set on_hand=on_hand+qty,version=version+1,updated_at=now()
      where company_id=p_company and item_id=item.id and location_id=loc.id;
    insert into public.inventory_movements(company_id,operation_id,item_id,location_id,quantity_units,kind,
      unit_cost_cents,unit_sale_cents,job_id,customer_id,invoice_id,notes)
      values(p_company,op,item.id,loc.id,qty,kind,item.cost_cents,item.sale_cents,job,customer,inv,note);
  end loop;
  return op;
end $$;
revoke all on function public.inventory_post(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_post(text,uuid,uuid,jsonb) to service_role;
