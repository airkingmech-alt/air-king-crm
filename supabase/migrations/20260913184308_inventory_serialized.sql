create table public.inventory_serials (
 id uuid primary key default gen_random_uuid(),company_id text not null,item_id uuid not null,location_id uuid not null,
 serial text not null check(length(trim(serial)) between 1 and 150),
 status text not null default 'In Stock' check(status in ('In Stock','Allocated','Installed')),
 job_id text references public.work_orders(id),customer_id text references public.customers(id),invoice_id text references public.invoices(id),
 property_id text,system_id text,installed_at date,received_at timestamptz not null default now(),
 cost_cents bigint not null check(cost_cents>=0),details jsonb not null default '{}',
 foreign key(company_id,item_id) references public.inventory_items(company_id,id),
 foreign key(company_id,location_id) references public.inventory_locations(company_id,id)
);
create unique index inventory_serial_identity on public.inventory_serials(company_id,item_id,lower(trim(serial)));
create index inventory_serial_location on public.inventory_serials(company_id,location_id);
create index inventory_serial_job on public.inventory_serials(job_id);
create index inventory_serial_customer on public.inventory_serials(customer_id);
create index inventory_serial_invoice on public.inventory_serials(invoice_id);
alter table public.inventory_serials enable row level security;
revoke all on public.inventory_serials from public,anon,authenticated;
grant all on public.inventory_serials to service_role;

create function public.inventory_serial_action(p_company text,p_actor uuid,p_key uuid,p_body jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 role_name text; prior public.inventory_operations%rowtype;op uuid;u public.inventory_serials%rowtype;
 it public.inventory_items%rowtype;loc uuid;job text;cust text;inv text;
 customer_data jsonb;properties jsonb;property jsonb;systems jsonb;sys jsonb;existing jsonb;
 prop_index integer;system_index integer;match_count integer;systemid text;installed date;
begin
 select role into role_name from public.profiles where id=p_actor and company_id=p_company;
 if not found or role_name not in ('owner','admin') then raise exception 'Administrator access required';end if;
 if p_key is null then raise exception 'Request key required';end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:'||p_company,0));
 select * into prior from public.inventory_operations where company_id=p_company and request_key=p_key;
 if found then
 if prior.payload<>p_body or prior.actor_id<>p_actor then raise exception 'Request key reused with different details';end if;
 return (p_body->>'id')::uuid;
 end if;
 insert into public.inventory_operations(company_id,request_key,actor_id,payload) values(p_company,p_key,p_actor,p_body) returning id into op;
 if p_body->>'action'='receive' then
  select * into it from public.inventory_items where company_id=p_company and id=(p_body->>'item_id')::uuid and serialized and tracked and active;
  if not found then raise exception 'Select an active serialized item';end if;
  loc:=(p_body->>'location_id')::uuid;
  if not exists(select 1 from public.inventory_locations where company_id=p_company and id=loc and active and coalesce(details->>'system_transit','false')<>'true') then raise exception 'Location not found';end if;
  insert into public.inventory_serials(id,company_id,item_id,location_id,serial,cost_cents,details)
   values((p_body->>'id')::uuid,p_company,it.id,loc,trim(p_body->>'serial'),it.cost_cents,coalesce(p_body->'details','{}')) returning * into u;
  perform public.inventory_move(p_company,op,it.id,loc,1000,'Receipt',it.cost_cents,null,'Serial receipt: '||u.serial);
  return u.id;
 end if;
 select * into u from public.inventory_serials where company_id=p_company and id=(p_body->>'id')::uuid for update;
 if not found then raise exception 'Equipment not found';end if;
 select * into it from public.inventory_items where id=u.item_id;
 if p_body->>'action'='allocate' and u.status='In Stock' then
  job:=p_body->>'job_id';
  if not exists(select 1 from public.work_orders where company_id=p_company and id=job) then raise exception 'Job not found';end if;
  update public.inventory_stock set reserved=reserved+1000,version=version+1 where company_id=p_company and item_id=u.item_id and location_id=u.location_id and on_hand-reserved>=1000;
  if not found then raise exception 'Insufficient stock';end if;
  update public.inventory_serials set status='Allocated',job_id=job where id=u.id;return u.id;
 elsif p_body->>'action'='release' and u.status='Allocated' then
  update public.inventory_stock set reserved=reserved-1000,version=version+1 where company_id=p_company and item_id=u.item_id and location_id=u.location_id;
  update public.inventory_serials set status='In Stock',job_id=null where id=u.id;return u.id;
 elsif p_body->>'action'='install' and u.status in ('In Stock','Allocated') then
  job:=p_body->>'job_id';inv:=nullif(p_body->>'invoice_id','');
  if u.status='Allocated' and u.job_id is distinct from job then raise exception 'Equipment is allocated to a different job';end if;
  select customer_id into cust from public.work_orders where company_id=p_company and id=job;
  if not found then raise exception 'Job not found';end if;
  if inv is not null and not exists(select 1 from public.invoices where company_id=p_company and id=inv and customer_id=cust) then raise exception 'Invoice does not match customer';end if;
  select data into customer_data from public.customers where company_id=p_company and id=cust for update;
  properties:=coalesce(customer_data->'properties','[]');
  select ordinality::integer-1,value into prop_index,property from jsonb_array_elements(properties) with ordinality where value->>'id'=p_body->>'property_id';
  if property is null then raise exception 'Select the customer property receiving the equipment';end if;
  systems:=coalesce(property->'systems','[]');installed:=(p_body->>'installed_at')::date;
  if installed is null then raise exception 'Installation date required';end if;
  select count(*) into match_count from jsonb_array_elements(systems) s where s->>'inventoryUnitId'=u.id::text or (lower(trim(s->>'serial'))=lower(trim(u.serial)) and s->>'model'=it.details->>'model');
  if match_count>1 then raise exception 'Multiple equipment matches require manual review';end if;
  if match_count=0 and nullif(p_body->>'existing_system_id','') is not null then
   select ordinality::integer-1,value into system_index,existing from jsonb_array_elements(systems) with ordinality where value->>'id'=p_body->>'existing_system_id' and nullif(value->>'inventoryUnitId','') is null and coalesce(value->>'serial','') in ('','Not recorded');
   if existing is null then raise exception 'Provisional equipment record not found or already linked';end if;
   systemid:=existing->>'id';match_count:=1;
  elsif match_count=1 then
   select ordinality::integer-1,value into system_index,existing from jsonb_array_elements(systems) with ordinality where value->>'inventoryUnitId'=u.id::text or (lower(trim(value->>'serial'))=lower(trim(u.serial)) and value->>'model'=it.details->>'model');
   systemid:=existing->>'id';
  else systemid:='sys-'||u.id;end if;
  if coalesce(p_body->>'equipment_type','') not in ('AC','Coil','Furnace','Air Handler','Heat Pump','Mini-Split','Package Unit') then raise exception 'Choose a supported equipment type';end if;
  sys:=coalesce(existing,'{}')||jsonb_build_object('id',systemid,'inventoryUnitId',u.id,'type',p_body->>'equipment_type','brand',coalesce(it.details->>'brand',''),'model',coalesce(it.details->>'model',''),'serial',u.serial,'installDate',installed,'status','Active','notes','Installed from inventory. Job '||job||coalesce(' · Invoice '||inv,''),'jobId',job,'invoiceId',inv);
  if nullif(p_body->>'warranty_exp','') is not null then sys:=sys||jsonb_build_object('warrantyExp',(p_body->>'warranty_exp')::date);end if;
  if match_count=1 then systems:=jsonb_set(systems,array[system_index::text],sys);else systems:=systems||jsonb_build_array(sys);end if;
  property:=jsonb_set(property,'{systems}',systems);properties:=jsonb_set(properties,array[prop_index::text],property);
  if u.status='Allocated' then update public.inventory_stock set reserved=reserved-1000 where company_id=p_company and item_id=u.item_id and location_id=u.location_id;end if;
  perform public.inventory_move(p_company,op,u.item_id,u.location_id,-1000,'Job Usage',u.cost_cents,job,'Installed serial '||u.serial);
  update public.customers set data=jsonb_set(customer_data,'{properties}',properties),updated_at=now() where id=cust;
  update public.inventory_serials set status='Installed',job_id=job,customer_id=cust,invoice_id=inv,property_id=p_body->>'property_id',system_id=systemid,installed_at=installed where id=u.id;
  return u.id;
 end if;
 raise exception 'This equipment action is not available';
end $$;
revoke all on function public.inventory_serial_action(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_serial_action(text,uuid,uuid,jsonb) to service_role;
