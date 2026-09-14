create table public.inventory_vendors (
 id uuid primary key default gen_random_uuid(),company_id text not null,
 name text not null check(length(trim(name)) between 1 and 200), active boolean not null default true,
 details jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(company_id,id)
);
create table public.inventory_documents (
 id uuid primary key default gen_random_uuid(),company_id text not null,
 number bigint generated always as identity,
 kind text not null check(kind in ('Purchase Order','Transfer','Count','Allocation','Template')),
 status text not null default 'Draft',
 location_id uuid not null, destination_id uuid, vendor_id uuid,
 job_id text references public.work_orders(id),
 created_by uuid not null references public.profiles(id),
 details jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),
 foreign key(company_id,location_id) references public.inventory_locations(company_id,id),
 foreign key(company_id,destination_id) references public.inventory_locations(company_id,id),
 foreign key(company_id,vendor_id) references public.inventory_vendors(company_id,id)
);
create table public.inventory_document_lines (
 id uuid primary key default gen_random_uuid(), company_id text not null,document_id uuid not null,item_id uuid not null,
 quantity bigint not null check(quantity>=0),processed bigint not null default 0 check(processed>=0),
 cost_cents bigint not null check(cost_cents>=0),expected_version bigint,
 details jsonb not null default '{}',
 foreign key(company_id,document_id) references public.inventory_documents(company_id,id),
 foreign key(company_id,item_id) references public.inventory_items(company_id,id),
 unique(document_id,item_id)
);
create index inventory_documents_location on public.inventory_documents(company_id,location_id);
create index inventory_documents_destination on public.inventory_documents(company_id,destination_id);
create index inventory_documents_vendor on public.inventory_documents(company_id,vendor_id);
create index inventory_documents_job on public.inventory_documents(job_id);
create index inventory_documents_creator on public.inventory_documents(created_by);
create index inventory_documents_queue on public.inventory_documents(company_id,kind,status);
create index inventory_document_lines_document on public.inventory_document_lines(company_id,document_id);
create index inventory_document_lines_item on public.inventory_document_lines(company_id,item_id);
do $$ declare t text;begin
 foreach t in array array['inventory_vendors','inventory_documents','inventory_document_lines'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.inventory_documents_number_seq to service_role;

-- Internal posting primitive. Only the trusted server role can call it.
create function public.inventory_move(p_company text,p_op uuid,p_item uuid,p_location uuid,p_qty bigint,p_kind text,p_cost bigint,p_job text,p_note text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare cust text; sale bigint;begin
 if p_qty=0 then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_company,0));
 if p_job is not null then
 select customer_id into cust from public.work_orders where company_id=p_company and id=p_job;
 if not found then raise exception 'Job not found';end if;
 end if;
 select sale_cents into sale from public.inventory_items where company_id=p_company and id=p_item;
 if not found then raise exception 'Item not found';end if;
 insert into public.inventory_stock(company_id,item_id,location_id) values(p_company,p_item,p_location) on conflict do nothing;
 update public.inventory_stock set on_hand=on_hand+p_qty,version=version+1,updated_at=now()
 where company_id=p_company and item_id=p_item and location_id=p_location
 and on_hand::numeric+p_qty between reserved and 9007199254740991;
 if not found then raise exception 'Insufficient available inventory';end if;
 insert into public.inventory_movements(company_id,operation_id,item_id,location_id,quantity_units,kind,unit_cost_cents,unit_sale_cents,job_id,customer_id,notes)
 values(p_company,p_op,p_item,p_location,p_qty,p_kind,p_cost,sale,p_job,cust,p_note);
end $$;
revoke all on function public.inventory_move(text,uuid,uuid,uuid,bigint,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.inventory_move(text,uuid,uuid,uuid,bigint,text,bigint,text,text) to service_role;

create function public.inventory_workflow(p_company text,p_actor uuid,p_key uuid,p_body jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 role_name text; prior public.inventory_operations%rowtype;op uuid;doc public.inventory_documents%rowtype;
 ln public.inventory_document_lines%rowtype;item public.inventory_items%rowtype;st public.inventory_stock%rowtype;
 val jsonb; action text:=p_body->>'action'; docid uuid;loc uuid;dest uuid;vend uuid;job text;kind text;
 qty bigint;cost bigint;transit uuid; old_units numeric;new_cost bigint;
begin
 if p_company is null or p_actor is null or p_key is null then raise exception 'Missing operation identity';end if;
 select role into role_name from public.profiles where company_id=p_company and id=p_actor;
 if not found or role_name not in ('owner','admin','technician','dispatcher') then raise exception 'Staff access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_company,0));
 select * into prior from public.inventory_operations where company_id=p_company and request_key=p_key;
 if found then
 if prior.payload<>p_body or prior.actor_id<>p_actor then raise exception 'Request key reused with different details';end if;
 return (prior.payload->>'document_id')::uuid;
 end if;
 insert into public.inventory_operations(company_id,request_key,actor_id,payload) values(p_company,p_key,p_actor,p_body) returning id into op;
 if action='create' then
  docid:=(p_body->>'document_id')::uuid;loc:=(p_body->>'location_id')::uuid;
  dest:=nullif(p_body->>'destination_id','')::uuid;vend:=nullif(p_body->>'vendor_id','')::uuid;
  job:=nullif(p_body->>'job_id','');kind:=p_body->>'kind';
  if not exists(select 1 from public.inventory_locations where company_id=p_company and id=loc and active) then raise exception 'Location not found';end if;
  if role_name not in ('owner','admin') and (role_name<>'technician' or kind<>'Count' or not exists(select 1 from public.inventory_locations where id=loc and assigned_to=p_actor)) then raise exception 'Administrator access required';end if;
  if job is not null and not exists(select 1 from public.work_orders where company_id=p_company and id=job) then raise exception 'Job not found';end if;
  if kind='Allocation' and job is null then raise exception 'Select a job';end if;
  if kind='Purchase Order' and vend is null then raise exception 'Select a vendor';end if;
  if kind='Transfer' and (dest is null or dest=loc) then raise exception 'Choose two different locations';end if;
  if dest is not null and not exists(select 1 from public.inventory_locations where company_id=p_company and id=dest and active) then raise exception 'Destination not found';end if;
  if jsonb_typeof(p_body->'lines') is distinct from 'array' or jsonb_array_length(p_body->'lines') not between 1 and 200 then raise exception 'Enter movement lines';end if;
  insert into public.inventory_documents(id,company_id,kind,location_id,destination_id,vendor_id,job_id,created_by,details)
  values(docid,p_company,kind,loc,dest,vend,job,p_actor,coalesce(p_body->'details','{}'));
  for val in select value from jsonb_array_elements(p_body->'lines') loop
    select * into item from public.inventory_items where company_id=p_company and id=(val->>'item_id')::uuid and active and tracked;
    if not found then raise exception 'Tracked item not found';end if;
    if item.serialized then raise exception 'Use the serialized workflow';end if;
    if coalesce(val->>'quantity','') !~ '^[0-9]+$' then raise exception 'Invalid quantity';end if;
    qty:=(val->>'quantity')::bigint;
    if qty>9007199254740991 or (qty=0 and kind<>'Count') then raise exception 'Invalid quantity';end if;
    cost:=coalesce((val->>'cost_cents')::bigint,item.cost_cents);
    insert into public.inventory_stock(company_id,item_id,location_id) values(p_company,item.id,loc) on conflict do nothing;
    select * into st from public.inventory_stock where company_id=p_company and item_id=item.id and location_id=loc;
    insert into public.inventory_document_lines(company_id,document_id,item_id,quantity,cost_cents,expected_version,details)
    values(p_company,docid,item.id,qty,cost,st.version,jsonb_build_object('expected',st.on_hand));
  end loop;
  return docid;
 end if;
 docid:=(p_body->>'document_id')::uuid;
 select * into doc from public.inventory_documents where company_id=p_company and id=docid for update;
 if not found then raise exception 'Document not found';end if;
 if role_name not in ('owner','admin') then
  if role_name<>'technician' or not (
   (doc.kind='Count' and action='submit' and doc.created_by=p_actor) or
   (doc.kind='Transfer' and action='receive' and exists(select 1 from public.inventory_locations where id=doc.destination_id and assigned_to=p_actor))
  ) then raise exception 'Administrator access required';end if;
 end if;
 if action='apply' and doc.kind='Template' and doc.status='Draft' then
  dest:=(p_body->>'destination_id')::uuid;
  if not exists(select 1 from public.inventory_locations where company_id=p_company and id=dest and active and coalesce(details->>'system_transit','false')<>'true') then raise exception 'Destination not found';end if;
  for ln in select * from public.inventory_document_lines where document_id=doc.id loop
   perform public.inventory_set_policy(p_company,p_actor,ln.item_id,dest,ln.quantity,ln.quantity,'');
  end loop;
  return doc.id;
 elsif action='cancel' then
  if doc.status in ('Received','Posted','Consumed','Cancelled','In Transit','Partially Received') then raise exception 'Cannot cancel stock already moved';end if;
  if doc.kind in ('Transfer','Allocation') and doc.status in ('Ready','Picked','Reserved') then
   for ln in select * from public.inventory_document_lines where document_id=doc.id loop
    update public.inventory_stock set reserved=reserved-ln.quantity,version=version+1 where company_id=p_company and item_id=ln.item_id and location_id=doc.location_id;
   end loop;
  end if;
  update public.inventory_documents set status='Cancelled',updated_at=now() where id=doc.id;return doc.id;
 elsif action='submit' and doc.kind in ('Purchase Order','Count') and doc.status='Draft' then
  update public.inventory_documents set status='Submitted',updated_at=now() where id=doc.id;return doc.id;
 elsif action='order' and doc.kind='Purchase Order' and doc.status='Submitted' then
  update public.inventory_documents set status='Ordered',updated_at=now() where id=doc.id;return doc.id;
 elsif action='pick' and doc.kind='Transfer' and doc.status='Ready' then
  update public.inventory_documents set status='Picked',updated_at=now() where id=doc.id;return doc.id;
 elsif action='reserve' and doc.kind in ('Transfer','Allocation') and doc.status='Draft' then
  for ln in select * from public.inventory_document_lines where document_id=doc.id loop
   update public.inventory_stock set reserved=reserved+ln.quantity,version=version+1 where company_id=p_company and item_id=ln.item_id and location_id=doc.location_id and on_hand-reserved>=ln.quantity;
   if not found then raise exception 'Insufficient available stock';end if;
  end loop;
  update public.inventory_documents set status=case when doc.kind='Transfer' then 'Ready' else 'Reserved' end,updated_at=now() where id=doc.id;return doc.id;
 elsif action='dispatch' and doc.kind='Transfer' and doc.status='Picked' then
  insert into public.inventory_locations(company_id,name,type,details) values(p_company,'Inventory in transit','Other','{"system_transit":true}') on conflict(company_id,name) do nothing;
  select id into transit from public.inventory_locations where company_id=p_company and name='Inventory in transit' and details->>'system_transit'='true';
  if transit is null then raise exception 'The reserved transit location name is already in use';end if;
  for ln in select * from public.inventory_document_lines where document_id=doc.id loop
   update public.inventory_stock set reserved=reserved-ln.quantity where company_id=p_company and item_id=ln.item_id and location_id=doc.location_id;
   perform public.inventory_move(p_company,op,ln.item_id,doc.location_id,-ln.quantity,'Transfer Out',ln.cost_cents,doc.job_id,'Transfer '||doc.number);
   perform public.inventory_move(p_company,op,ln.item_id,transit,ln.quantity,'Transfer In',ln.cost_cents,doc.job_id,'In transit '||doc.number);
   update public.inventory_stock set reserved=reserved+ln.quantity where company_id=p_company and item_id=ln.item_id and location_id=transit;
  end loop;
  update public.inventory_documents set status='In Transit',updated_at=now() where id=doc.id;return doc.id;
 elsif action='consume' and doc.kind='Allocation' and doc.status='Reserved' then
  for ln in select * from public.inventory_document_lines where document_id=doc.id loop
   update public.inventory_stock set reserved=reserved-ln.quantity where company_id=p_company and item_id=ln.item_id and location_id=doc.location_id;
   perform public.inventory_move(p_company,op,ln.item_id,doc.location_id,-ln.quantity,'Job Usage',ln.cost_cents,doc.job_id,'Allocated job usage '||doc.number);
  end loop;
  update public.inventory_documents set status='Consumed',updated_at=now() where id=doc.id;return doc.id;
 elsif action='post' and doc.kind='Count' and doc.status in ('Draft','Submitted') then
  for ln in select * from public.inventory_document_lines where document_id=doc.id loop
   select * into st from public.inventory_stock where company_id=p_company and item_id=ln.item_id and location_id=doc.location_id;
   if st.version<>ln.expected_version then raise exception 'Stock changed after count creation. Recount before posting.';end if;
   perform public.inventory_move(p_company,op,ln.item_id,doc.location_id,ln.quantity-st.on_hand,'Count',ln.cost_cents,null,'Approved count '||doc.number);
  end loop;
  update public.inventory_documents set status='Posted',updated_at=now() where id=doc.id;return doc.id;
 elsif action='receive' and ((doc.kind='Purchase Order' and doc.status in ('Ordered','Partially Received')) or (doc.kind='Transfer' and doc.status in ('In Transit','Partially Received'))) then
  if jsonb_typeof(p_body->'lines') is distinct from 'array' or jsonb_array_length(p_body->'lines') not between 1 and 200 then raise exception 'Receipt lines required';end if;
  if doc.kind='Transfer' then select id into transit from public.inventory_locations where company_id=p_company and name='Inventory in transit' and details->>'system_transit'='true';end if;
  for val in select value from jsonb_array_elements(p_body->'lines') loop
   select * into ln from public.inventory_document_lines where document_id=doc.id and id=(val->>'line_id')::uuid;
   if not found then raise exception 'Receipt line not found';end if;
   if coalesce(val->>'quantity','') !~ '^[0-9]+$' then raise exception 'Invalid receipt';end if;
   qty:=(val->>'quantity')::bigint;
   if qty<=0 or qty>ln.quantity-ln.processed then raise exception 'Receipt exceeds remaining quantity';end if;
   if doc.kind='Transfer' then
    update public.inventory_stock set reserved=reserved-qty where company_id=p_company and item_id=ln.item_id and location_id=transit;
    perform public.inventory_move(p_company,op,ln.item_id,transit,-qty,'Transfer Out',ln.cost_cents,doc.job_id,'Transit receipt '||doc.number);
    perform public.inventory_move(p_company,op,ln.item_id,doc.destination_id,qty,'Transfer In',ln.cost_cents,doc.job_id,'Truck receipt '||doc.number);
   else
    select coalesce(sum(on_hand),0) into old_units from public.inventory_stock where company_id=p_company and item_id=ln.item_id;
    select round((old_units*cost_cents+qty::numeric*ln.cost_cents)/(old_units+qty)) into new_cost from public.inventory_items where id=ln.item_id;
    update public.inventory_items set cost_cents=new_cost,details=details||jsonb_build_object('last_purchase_cost_cents',ln.cost_cents),updated_at=now() where id=ln.item_id;
    perform public.inventory_move(p_company,op,ln.item_id,doc.location_id,qty,'Receipt',ln.cost_cents,doc.job_id,'PO receipt '||doc.number);
   end if;
   update public.inventory_document_lines set processed=processed+qty where id=ln.id;
  end loop;
  update public.inventory_documents set status=case when exists(select 1 from public.inventory_document_lines where document_id=doc.id and processed<quantity) then 'Partially Received' else 'Received' end,updated_at=now() where id=doc.id;
  return doc.id;
 end if;
 raise exception 'This action is not available for the current document status';
end $$;
revoke all on function public.inventory_workflow(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_workflow(text,uuid,uuid,jsonb) to service_role;

create function public.inventory_set_policy(p_company text,p_actor uuid,p_item uuid,p_location uuid,p_minimum bigint,p_target bigint,p_bin text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$ begin
 if not exists(select 1 from public.profiles where company_id=p_company and id=p_actor and role in ('owner','admin')) then raise exception 'Administrator access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_company,0));
 if p_minimum is null or p_target is null or p_minimum<0 or p_target<p_minimum or p_target>9007199254740991 then raise exception 'Invalid stock policy';end if;
 insert into public.inventory_stock(company_id,item_id,location_id,minimum,target,bin)
 values(p_company,p_item,p_location,p_minimum,p_target,coalesce(p_bin,''))
 on conflict(company_id,item_id,location_id) do update set minimum=excluded.minimum,target=excluded.target,bin=excluded.bin,updated_at=now();
end $$;
revoke all on function public.inventory_set_policy(text,uuid,uuid,uuid,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.inventory_set_policy(text,uuid,uuid,uuid,bigint,bigint,text) to service_role;
