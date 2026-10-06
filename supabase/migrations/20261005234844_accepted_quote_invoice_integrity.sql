set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- No historical records are rewritten. This default is only for not-yet-accepted
-- legacy drafts; new drafts persist their own displayed add-on catalog.
create or replace function public.crm_quote_addon_catalog() returns jsonb
language sql immutable security invoker set search_path=public,pg_temp as $$
 select '[{"id":"duct-clean","name":"Whole-Home Duct Cleaning","price":449,"icon":"wind","description":"Complete duct system cleaning to improve air quality and system efficiency"},{"id":"humidifier","name":"Whole-Home Humidifier","price":649,"icon":"droplet","description":"Balanced humidity throughout your home for comfort and health"},{"id":"surge-protector","name":"HVAC Surge Protector","price":299,"icon":"zap","description":"Protect your investment from power surges and voltage spikes"},{"id":"wifi-thermostat","name":"Wi-Fi Smart Thermostat","price":399,"icon":"thermostat","description":"Control your system from anywhere with smart scheduling"},{"id":"media-cleaner","name":"Media Air Cleaner","price":549,"icon":"filter","description":"Hospital-grade filtration for cleaner indoor air"},{"id":"crown-care","name":"Crown Care Membership","price":189,"icon":"crown","description":"Two seasonal precision tune-ups plus priority service"}]'::jsonb
$$;

create or replace function public.crm_build_accepted_scope(d jsonb) returns jsonb
language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare opt jsonb; addon jsonb; addon_id text; catalog jsonb; addons jsonb:='[]'; items jsonb; total numeric; price numeric; ids jsonb; equipment jsonb;
begin
 if jsonb_typeof(d->'options') is distinct from 'array' then raise exception 'Review the quote options before accepting'; end if;
 if (select count(*) from jsonb_array_elements(d->'options') o where o->>'tier'=d->>'selectedOption')<>1 then
  raise exception 'Choose an explicit approved option';
 end if;
 select value into opt from jsonb_array_elements(d->'options') where value->>'tier'=d->>'selectedOption';
 if jsonb_typeof(opt->'customerPrice') is distinct from 'number' then raise exception 'The approved option needs a verified price'; end if;
 total:=(opt->>'customerPrice')::numeric;
 if total<0 or total<>round(total,2) or total>100000000 then raise exception 'Invalid approved option price'; end if;
 ids:=coalesce(d->'selectedAddOns','[]');
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>20 then raise exception 'Invalid add-on selection'; end if;
 if (select count(*) from jsonb_array_elements_text(ids))<>(select count(distinct value) from jsonb_array_elements_text(ids)) then raise exception 'Duplicate add-on selection'; end if;
 catalog:=coalesce(d->'addOnCatalog',public.crm_quote_addon_catalog());
 if jsonb_typeof(catalog)<>'array' then raise exception 'Review the quote add-on prices'; end if;
 items:=jsonb_build_array(jsonb_build_object('description',coalesce(opt->>'label',opt->>'tier')||' package — '||coalesce(d->>'title','Accepted quote')||case when nullif(coalesce(opt->>'equipmentSummary',opt->>'equipment'),'') is not null then E'\nEquipment: '||coalesce(opt->>'equipmentSummary',opt->>'equipment') else '' end||case when nullif(d->>'laborDescription','') is not null then E'\n'||(d->>'laborDescription') else '' end,'amount',total));
 for addon_id in select value from jsonb_array_elements_text(ids) loop
  if (select count(*) from jsonb_array_elements(catalog) a where a->>'id'=addon_id)<>1 then raise exception 'An add-on price is missing. Review a new draft before accepting'; end if;
  select value into addon from jsonb_array_elements(catalog) where value->>'id'=addon_id;
  if jsonb_typeof(addon->'price') is distinct from 'number' or nullif(addon->>'name','') is null then raise exception 'Invalid add-on price'; end if;
  price:=(addon->>'price')::numeric;
  if price<0 or price<>round(price,2) or price>100000000 then raise exception 'Invalid add-on price'; end if;
  total:=total+price; addons:=addons||jsonb_build_array(addon);
  items:=items||jsonb_build_array(jsonb_build_object('description','Add-on — '||(addon->>'name'),'amount',price));
 end loop;
 -- Legacy tier resolvers depend on today's catalog. Preserve the accepted
 -- equipment text, but never infer old SKU substitutions for billing/installations.
 equipment:=coalesce(opt->'equipmentItems',case when d->>'equipmentSelectionMode'='explicit' then d->'equipmentItems' end,'[]');
 return jsonb_build_object('version',1,'quoteId',d->>'id','customerId',d->>'customerId','customerName',d->>'customerName',
  'title',d->>'title','laborDescription',coalesce(d->>'laborDescription',''),'selectedOption',d->>'selectedOption',
  'selectedAddOns',ids,'option',opt-'totalCost'-'equipmentCost'-'purchaseTax','addOns',addons,'items',items,'equipmentItems',equipment,'amount',total);
end $$;
revoke all on function public.crm_quote_addon_catalog(),public.crm_build_accepted_scope(jsonb) from public,anon;
grant execute on function public.crm_quote_addon_catalog(),public.crm_build_accepted_scope(jsonb) to authenticated,service_role;

create or replace function public.crm_guard_accepted_quote() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare ignored text[]:=array['firstViewedAt','sentAt','sentDate','deletedAt','deletedBy','convertedWorkOrderId','staffAcceptedAt'];
begin
 if tg_op='UPDATE' and (old.data->>'status'='Won' or old.data ? 'acceptedScope') then
  if new.customer_id is distinct from old.customer_id or new.company_id is distinct from old.company_id or new.id<>old.id
    or (new.data-ignored) is distinct from (old.data-ignored) then
   raise exception 'Accepted scope and prices are locked. Create a draft revision and obtain approval again';
  end if;
  return new;
 end if;
 if new.data->>'status'='Won' then
  if new.data->>'id' is distinct from new.id or new.data->>'customerId' is distinct from new.customer_id then raise exception 'Quote identity does not match its record'; end if;
  if current_user not in ('service_role','postgres','supabase_admin') then raise exception 'Use the quote approval action to accept this quote'; end if;
  new.data:=new.data||jsonb_build_object('acceptedScope',public.crm_build_accepted_scope(new.data));
 elsif new.data ? 'acceptedScope' then
  raise exception 'An acceptance snapshot can only be created by quote approval';
 end if;
 return new;
end $$;
create trigger crm_20_accepted_quote before insert or update on public.quotes for each row execute function public.crm_guard_accepted_quote();

-- Customer signatures retain the same priced scope as the quote, inside the
-- existing acceptance transaction. Historical snapshots are never backfilled.
create or replace function public.crm_guard_quote_acceptance() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' then
  if new is distinct from old then raise exception 'Acceptance records are immutable'; end if;
  return new;
 end if;
 if new.decision='accepted' then new.snapshot:=new.snapshot||jsonb_build_object('acceptedScope',public.crm_build_accepted_scope(new.snapshot)); end if;
 return new;
end $$;
create trigger crm_20_quote_acceptance before insert or update on public.quote_acceptances for each row execute function public.crm_guard_quote_acceptance();

-- Keep the durable quote/job relationship used by historical job-only invoices.
-- Approval RPCs create their job before their final quote update, in one transaction.
create or replace function public.crm_guard_quote_job_link() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
  if nullif(old.data->>'quoteId','') is not null then raise exception 'Quote-linked jobs must be retained with their billing history'; end if;
  return old;
 end if;
 if tg_op='INSERT' then
  if nullif(new.data->>'quoteId','') is not null and current_user not in ('service_role','postgres','supabase_admin') then
   raise exception 'Use quote approval to create a quote-linked job';
  end if;
 elsif nullif(new.data->>'quoteId','') is distinct from nullif(old.data->>'quoteId','') then
  raise exception 'A job quote link cannot be added, removed or changed. Use quote approval for new work';
 elsif nullif(old.data->>'quoteId','') is not null and
   (new.id is distinct from old.id or new.company_id is distinct from old.company_id or new.customer_id is distinct from old.customer_id
    or new.data->>'id' is distinct from old.data->>'id' or new.data->>'customerId' is distinct from old.data->>'customerId') then
  raise exception 'Quote-linked job identity is locked';
 end if;
 return new;
end $$;
create trigger crm_19_quote_job_link before insert or update or delete on public.work_orders for each row execute function public.crm_guard_quote_job_link();

-- A uniqueness constraint, rather than just a pre-insert check, is the final
-- concurrency guard even for callers in repeatable-read transactions.
create unique index crm_active_invoice_quote on public.invoices(company_id,(data->>'quoteId'))
 where nullif(data->>'quoteId','') is not null and data->>'deletedAt' is null;

-- Validation must see the durable job link even for staff with invoice access
-- but no scheduling access. This private trigger exposes no callable API and
-- does not change the DML caller's RLS, ownership or grants.
create or replace function crm_private.guard_quote_invoice() returns trigger
language plpgsql security definer set search_path='' as $$
declare q public.quotes; scope jsonb; quote_id text; job_quote text; locked_keys text[]:=array['quoteId','quoteAcceptance','amount','items','equipmentItems','customerId','customerName','workOrderId']; k text;
begin
 if tg_op='UPDATE' and nullif(old.data->>'workOrderId','') is not null then
  select data->>'quoteId' into job_quote from public.work_orders where id=old.data->>'workOrderId' and company_id=old.company_id;
 end if;
 if tg_op='UPDATE' and (nullif(old.data->>'quoteId','') is not null or old.data ? 'quoteAcceptance' or nullif(job_quote,'') is not null) then
  -- Preserve historical invoices too; payments, delivery, voiding and soft
  -- deletion can update operational fields without rewriting the contract.
  foreach k in array locked_keys loop
   if new.data->k is distinct from old.data->k then raise exception 'Quote invoice scope is locked. Create an approved revision for changes'; end if;
  end loop;
  if new.company_id is distinct from old.company_id or new.customer_id is distinct from old.customer_id then raise exception 'Quote invoice customer is locked'; end if;
  return new;
 end if;
 quote_id:=nullif(new.data->>'quoteId','');
 if nullif(new.data->>'workOrderId','') is not null then
  select data->>'quoteId' into job_quote from public.work_orders where id=new.data->>'workOrderId' and company_id=new.company_id and customer_id=new.customer_id;
  if not found then raise exception 'Invoice job unavailable or belongs to another customer'; end if;
  if nullif(job_quote,'') is not null then
   if quote_id is not null and quote_id<>job_quote then raise exception 'Invoice quote and job do not match'; end if;
   quote_id:=job_quote;
  end if;
 end if;
 if quote_id is null then
  if new.data ? 'quoteAcceptance' then raise exception 'Invalid quote acceptance reference'; end if;
  return new;
 end if;
 if current_setting('role',true)='authenticated' and not exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.company_id=new.company_id
   and p.role in ('owner','admin','dispatcher','technician')
   and (p.role='owner' or coalesce(p.permissions->'quotes','true'::jsonb)<>'false'::jsonb)) then
  raise exception 'Quote access is required to create a quote-linked invoice';
 end if;
 select * into q from public.quotes where id=quote_id and company_id=new.company_id for update;
 if not found or q.data->>'deletedAt' is not null or q.data->>'status'<>'Won' then raise exception 'Choose an active accepted quote'; end if;
 scope:=q.data->'acceptedScope';
 if scope->>'version' is distinct from '1' then raise exception 'This legacy acceptance has no verified price snapshot. Review a draft revision and obtain approval before invoicing'; end if;
 if new.customer_id is distinct from q.customer_id or new.data->>'customerId' is distinct from q.customer_id
   or new.data->'amount' is distinct from scope->'amount' or new.data->'items' is distinct from scope->'items' then
  raise exception 'Create the invoice from the accepted quote to preserve its approved scope and price';
 end if;
 if exists(select 1 from public.invoices i where i.company_id=new.company_id and i.id<>new.id and i.data->>'deletedAt' is null
   and (i.data->>'quoteId'=q.id or exists(select 1 from public.work_orders w where w.id=i.data->>'workOrderId' and w.company_id=new.company_id and w.data->>'quoteId'=q.id))) then
  raise exception 'An invoice already exists for this accepted quote. Open the existing invoice';
 end if;
 new.data:=new.data||jsonb_build_object('quoteId',q.id,'quoteAcceptance',scope,'customerName',scope->'customerName','equipmentItems',scope->'equipmentItems');
 return new;
end $$;
create trigger crm_20_quote_invoice before insert or update on public.invoices for each row execute function crm_private.guard_quote_invoice();

create or replace function public.crm_invoice_accepted_quote(p_company text,p_actor uuid,p_quote text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare q public.quotes; scope jsonb; saved jsonb; invoice_id text; job_id text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and company_id=p_company and role in ('owner','admin','dispatcher','technician') and (role='owner' or (coalesce(permissions->'quotes','true')<>'false' and coalesce(permissions->'invoices','true')<>'false'))) then raise exception 'Quote and invoice access required'; end if;
 select * into strict q from public.quotes where id=p_quote and company_id=p_company for update;
 if q.data->>'deletedAt' is not null or q.data->>'status'<>'Won' then raise exception 'Choose an active accepted quote'; end if;
 select i.data into saved from public.invoices i where i.company_id=p_company and i.customer_id=q.customer_id and i.data->>'deletedAt' is null
  and (i.data->>'quoteId'=p_quote or exists(select 1 from public.work_orders w where w.id=i.data->>'workOrderId' and w.company_id=p_company and w.customer_id=q.customer_id and w.data->>'quoteId'=p_quote))
  order by i.created_at limit 1;
 if found then return saved; end if;
 select id into job_id from public.work_orders where company_id=p_company and data->>'quoteId'=p_quote and data->>'deletedAt' is null order by created_at limit 1;
 if job_id is not null then
  select data into saved from public.invoices where company_id=p_company and data->>'workOrderId'=job_id and data->>'deletedAt' is null limit 1;
  if found then return saved; end if;
 end if;
 scope:=q.data->'acceptedScope';
 if scope->>'version' is distinct from '1' then raise exception 'This legacy acceptance has no verified price snapshot. Review a draft revision and obtain approval before invoicing'; end if;
 invoice_id:='INV-'||gen_random_uuid();
 saved:=jsonb_strip_nulls(jsonb_build_object('id',invoice_id,'customerId',q.customer_id,'customerName',scope->'customerName',
  'quoteId',p_quote,'workOrderId',job_id,'quoteAcceptance',scope,'equipmentItems',scope->'equipmentItems',
  'amount',scope->'amount','paidAmount',0,'status','Draft','dueDate',to_char(current_date+30,'YYYY-MM-DD'),'items',scope->'items'));
 insert into public.invoices(id,company_id,customer_id,data) values(invoice_id,p_company,q.customer_id,saved) returning data into saved;
 return saved;
end $$;
revoke all on function public.crm_invoice_accepted_quote(text,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_invoice_accepted_quote(text,uuid,text) to service_role;

create or replace function public.crm_revise_accepted_quote(p_company text,p_actor uuid,p_quote text,p_request uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare q public.quotes; saved jsonb; revision_id text:='Q-R-'||p_request;
begin
 if not exists(select 1 from public.profiles where id=p_actor and company_id=p_company and role in ('owner','admin','dispatcher','technician') and (role='owner' or coalesce(permissions->'quotes','true')<>'false')) then raise exception 'Quote access required'; end if;
 select * into strict q from public.quotes where id=p_quote and company_id=p_company for update;
 if q.data->>'deletedAt' is not null or q.data->>'status'<>'Won' then raise exception 'Choose an active accepted quote to revise'; end if;
 select data into saved from public.quotes where id=revision_id and company_id=p_company;
 if found then
  if saved->>'revisionOf' is distinct from p_quote then raise exception 'Revision request conflict'; end if;
  return saved;
 end if;
 saved:=(q.data-array['acceptedScope','acceptedAt','staffAcceptedAt','declinedAt','convertedWorkOrderId','firstViewedAt','sentAt','sentDate','expiresAt','deletedAt','deletedBy'])||
  jsonb_build_object('id',revision_id,'status','Draft','createdAt',to_char(current_date,'YYYY-MM-DD'),'revisionOf',p_quote,'revisedBy',p_actor,
   'addOnCatalog',coalesce(q.data->'addOnCatalog',public.crm_quote_addon_catalog()),
   'internalReviewNote','Revision of '||p_quote||'. Review scope and prices, then obtain fresh approval. Existing jobs and invoices remain separate.');
 insert into public.quotes(id,company_id,customer_id,data) values(revision_id,p_company,q.customer_id,saved) returning data into saved;
 return saved;
end $$;
revoke all on function public.crm_revise_accepted_quote(text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_revise_accepted_quote(text,uuid,text,uuid) to service_role;

revoke all on function public.crm_guard_accepted_quote(),public.crm_guard_quote_acceptance(),public.crm_guard_quote_job_link(),crm_private.guard_quote_invoice() from public,anon,authenticated;
