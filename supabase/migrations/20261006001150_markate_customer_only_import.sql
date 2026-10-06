-- Customer-only imports are explicit, reviewed, replay-safe, and never lead events.
-- Audit/source material remains private; no browser or anonymous grants are added.
create schema crm_import;
revoke all on schema crm_import from public,anon,authenticated,service_role;
create table crm_import.customer_import_batches (
 company_id text not null, id uuid not null, actor_id uuid not null,
 request_hash text not null, expected_snapshot text not null, transaction_id bigint not null,
 status text not null check(status in ('running','completed')),
 before_snapshot jsonb not null, result jsonb, created_at timestamptz not null default now(),
 primary key(company_id,id)
);
create table crm_import.customer_import_rows (
 company_id text not null, batch_id uuid not null, source_id text not null,
 customer_id text not null, action text not null check(action in ('create','link')),
 before_row jsonb, source_data jsonb not null, after_data jsonb not null,
 primary key(company_id,source_id), unique(company_id,customer_id),
 foreign key(company_id,batch_id) references crm_import.customer_import_batches(company_id,id),
 foreign key(customer_id) references public.customers(id) deferrable initially deferred
);
alter table crm_import.customer_import_batches enable row level security;
alter table crm_import.customer_import_rows enable row level security;
revoke all on crm_import.customer_import_batches,crm_import.customer_import_rows from public,anon,authenticated,service_role;
grant usage on schema crm_import to service_role;
grant select,insert,update on crm_import.customer_import_batches to service_role;
grant select,insert on crm_import.customer_import_rows to service_role;
create unique index customers_markate_source_id on public.customers(company_id,(data#>>'{sourceReferences,markate,customerId}'))
 where data#>>'{sourceReferences,markate,customerId}' is not null;

create function crm_import.assert_customer_import_actor(p_company text,p_actor uuid) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and company_id=p_company and role in ('owner','admin')
   and (role='owner' or coalesce(permissions->>'customers','true')<>'false')) then
  raise exception 'Customer import requires an authorized owner or administrator';
 end if;
end $$;

create function crm_import.customer_identity_keys(p_data jsonb) returns table(kind text,value text)
language sql immutable security invoker set search_path=pg_catalog as $$
 with contacts as (select value c from jsonb_array_elements(coalesce(p_data->'contacts','[]'))),
 raw as (
  select 'name' k,p_data->>'name' v union all select 'name',c->>'name' from contacts
  union all select 'email',c->>'email' from contacts
  union all select 'email',e from contacts cross join lateral jsonb_array_elements_text(coalesce(c->'additionalEmails','[]')) e
  union all select 'phone',c->>'phone' from contacts
  union all select 'phone',p->>'value' from contacts cross join lateral jsonb_array_elements(coalesce(c->'phoneNumbers','[]')) p
 ), normalized as (
  select k,case when k='name' then regexp_replace(lower(v),'[^a-z0-9]','','g')
    when k='email' then lower(btrim(v)) else regexp_replace(v,'[^0-9]','','g') end v from raw
 ) select distinct k,case when k='phone' and length(v)=11 and left(v,1)='1' then substr(v,2) else v end
 from normalized where coalesce(v,'')<>'';
$$;

create function public.crm_customer_import_state(p_company text,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare snapshot jsonb;
begin
 perform crm_import.assert_customer_import_actor(p_company,p_actor);
 select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into snapshot from public.customers c where company_id=p_company;
 return jsonb_build_object('snapshot',md5(snapshot::text),'customers',jsonb_array_length(snapshot));
end $$;

create function public.crm_import_markate_customers(
 p_company text,p_actor uuid,p_batch uuid,p_expected_snapshot text,p_expected_new integer,p_expected_links integer,p_records jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare batch crm_import.customer_import_batches; rec jsonb; payload jsonb; source_ref jsonb;
 snapshot jsonb; request_hash text; source_hash text; identifier text; source_id text;
 before_customer public.customers; saved jsonb; outcome jsonb; child jsonb; nested jsonb;
 inserted integer:=0; linked integer:=0; conflicts integer;
begin
 perform crm_import.assert_customer_import_actor(p_company,p_actor);
 if p_batch is null or p_expected_snapshot is null or p_expected_snapshot!~'^[a-f0-9]{32}$'
   or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 1000
   or p_expected_new is null or p_expected_links is null or p_expected_new<0 or p_expected_links<0 then
  raise exception 'Invalid reviewed import request';
 end if;
 if (select count(*) from jsonb_array_elements(p_records) r where r->>'mode'='create')<>p_expected_new
   or (select count(*) from jsonb_array_elements(p_records) r where r->>'mode'='link')<>p_expected_links
   or jsonb_array_length(p_records)<>p_expected_new+p_expected_links then raise exception 'Reviewed counts changed'; end if;
 request_hash:=md5(jsonb_build_object('records',p_records,'snapshot',p_expected_snapshot,'new',p_expected_new,'links',p_expected_links)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_company||':customer-import:'||p_batch,0));
 select * into batch from crm_import.customer_import_batches where company_id=p_company and id=p_batch;
 if found then
  if batch.request_hash<>request_hash or batch.status<>'completed' then raise exception 'Import batch was reused with different data'; end if;
  return batch.result||jsonb_build_object('replayed',true);
 end if;
 -- An ordinary UI create must not race between the reviewed snapshot and this batch.
 -- Short transaction-scoped write serialization; no trigger/automation is disabled.
 lock table public.customers in share row exclusive mode;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into snapshot from public.customers c where company_id=p_company;
 if md5(snapshot::text)<>p_expected_snapshot then raise exception 'Customers changed. Refresh the duplicate review before importing'; end if;
 if (select count(distinct r->>'sourceId') from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records) then
  raise exception 'Duplicate or missing source IDs'; end if;
 insert into crm_import.customer_import_batches(company_id,id,actor_id,request_hash,expected_snapshot,transaction_id,status,before_snapshot)
 values(p_company,p_batch,p_actor,request_hash,p_expected_snapshot,txid_current(),'running',snapshot);
 for rec in select value from jsonb_array_elements(p_records) loop
  if rec-array['mode','sourceId','customerId','customer']<>'{}'::jsonb then raise exception 'Unexpected import fields'; end if;
  payload:=rec->'customer'; source_id:=rec->>'sourceId'; source_ref:=payload#>'{sourceReferences,markate}';
  if source_id is null or source_id!~'^[0-9]{1,20}$' or jsonb_typeof(payload) is distinct from 'object'
   or payload-array['id','name','type','firstName','lastName','companyName','contacts','billingAddress','properties','sourceStatus','sourceReferences','leadSource','tags','activity','createdAt']<>'{}'::jsonb
   or payload->>'id' is distinct from 'cust-markate-'||source_id
   or coalesce(length(btrim(payload->>'name')),0)=0
   or coalesce(payload->>'type','') not in ('Residential','Commercial') or coalesce(payload->>'sourceStatus','') not in ('Active','Pending')
   or jsonb_typeof(payload->'contacts') is distinct from 'array' or jsonb_array_length(payload->'contacts')<1
   or jsonb_typeof(payload->'properties') is distinct from 'array'
   or payload->'tags' is distinct from '[]'::jsonb or payload->'activity' is distinct from '[]'::jsonb
   or payload->>'leadSource' is distinct from 'Unknown'
   or jsonb_typeof(payload->'billingAddress') is distinct from 'object'
   or (payload->'billingAddress')-array['street','unit','city','state','postalCode']<>'{}'::jsonb
   or jsonb_typeof(payload->'sourceReferences') is distinct from 'object' or (payload->'sourceReferences')-'markate'<>'{}'::jsonb
   or source_ref->>'customerId' is distinct from source_id or source_ref->>'batchId' is distinct from p_batch::text
   or source_ref->>'status' is distinct from payload->>'sourceStatus'
   or coalesce(source_ref->>'exportSha256','')!~'^[a-f0-9]{64}$'
   or source_ref-array['customerId','batchId','exportSha256','exportedAt','sourceAddedOn','sourceRow','status']<>'{}'::jsonb then
   raise exception 'Invalid customer-only payload';
  end if;
  if exists(select 1 from unnest(array['id','name','type','firstName','lastName','companyName','sourceStatus','leadSource','createdAt']) k
    where jsonb_typeof(payload->k) is distinct from 'string')
   or exists(select 1 from unnest(array['street','unit','city','state','postalCode']) k where jsonb_typeof(payload->'billingAddress'->k) is distinct from 'string')
   or jsonb_typeof(source_ref->'sourceAddedOn') is distinct from 'string'
   or jsonb_typeof(source_ref->'exportedAt') is distinct from 'string'
   or jsonb_typeof(source_ref->'sourceRow') is distinct from 'number' then raise exception 'Missing or invalid customer fields'; end if;
  if source_hash is null then source_hash:=source_ref->>'exportSha256';
  elsif source_hash<>source_ref->>'exportSha256' then raise exception 'Use one source export per batch'; end if;
  for child in select value from jsonb_array_elements(payload->'contacts') loop
   if jsonb_typeof(child) is distinct from 'object' or child-array['name','email','phone','role','phoneNumbers','additionalEmails','sourceText']<>'{}'::jsonb
    or jsonb_typeof(child->'phoneNumbers') is distinct from 'array'
    or (child ? 'additionalEmails' and jsonb_typeof(child->'additionalEmails') is distinct from 'array') then raise exception 'Invalid contact fields'; end if;
   if exists(select 1 from unnest(array['name','email','phone','role']) k where jsonb_typeof(child->k) is distinct from 'string') then raise exception 'Missing contact fields'; end if;
   for nested in select value from jsonb_array_elements(child->'phoneNumbers') loop
    if jsonb_typeof(nested) is distinct from 'object' or nested-array['label','value']<>'{}'::jsonb or jsonb_typeof(nested->'label') is distinct from 'string' or jsonb_typeof(nested->'value') is distinct from 'string' then raise exception 'Invalid phone fields'; end if;
   end loop;
   if child ? 'additionalEmails' and exists(select 1 from jsonb_array_elements(child->'additionalEmails') v where jsonb_typeof(v) is distinct from 'string') then raise exception 'Invalid additional emails'; end if;
  end loop;
  for child in select value from jsonb_array_elements(payload->'properties') loop
   if jsonb_typeof(child) is distinct from 'object' or child-array['id','sourceSlot','address','street','unit','city','state','zip','systems']<>'{}'::jsonb
    or child->'systems' is distinct from '[]'::jsonb or exists(select 1 from unnest(array['id','address','street','unit','city','state','zip']) k where jsonb_typeof(child->k) is distinct from 'string') then raise exception 'Only service addresses may be imported'; end if;
  end loop;
  if exists(select 1 from crm_import.customer_identity_keys(payload) where (kind='email' and (value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or value~'\.con$'))
    or (kind='phone' and length(value)<>10)) then raise exception 'Contact information requires validation'; end if;
  if exists(select 1 from crm_import.customer_import_rows r where r.company_id=p_company and r.source_id=rec->>'sourceId')
    or exists(select 1 from public.customers where company_id=p_company and data#>>'{sourceReferences,markate,customerId}'=source_id) then
   raise exception 'Source customer is already linked'; end if;
  if rec->>'mode'='create' then
   if rec ? 'customerId' then raise exception 'New imports cannot overwrite a destination'; end if;
   identifier:=payload->>'id';
   select count(*) into conflicts from public.customers c where company_id=p_company and exists(
    select 1 from crm_import.customer_identity_keys(payload) a join crm_import.customer_identity_keys(c.data) b using(kind,value));
   if conflicts>0 then raise exception 'Possible duplicate customer. Review identity before importing'; end if;
   insert into crm_import.customer_import_rows(company_id,batch_id,source_id,customer_id,action,source_data,after_data)
   values(p_company,p_batch,source_id,identifier,'create',payload,payload);
   insert into public.customers(id,company_id,data) values(identifier,p_company,payload) returning data into saved;
   inserted:=inserted+1;
  elsif rec->>'mode'='link' then
   identifier:=rec->>'customerId';
   select * into before_customer from public.customers where id=identifier and company_id=p_company for update;
   if not found or before_customer.data ? 'deletedAt' or before_customer.data#>'{sourceReferences,markate}' is not null then
    raise exception 'Existing customer is unavailable or already linked'; end if;
   select count(distinct a.kind) into conflicts from crm_import.customer_identity_keys(payload) a
    join crm_import.customer_identity_keys(before_customer.data) b using(kind,value);
   if conflicts<>3 then raise exception 'Existing link requires exact name, email, and phone'; end if;
   if jsonb_typeof(coalesce(before_customer.data->'sourceReferences','{}')) is distinct from 'object' then raise exception 'Invalid existing source references'; end if;
   payload:=before_customer.data||jsonb_build_object('sourceReferences',coalesce(before_customer.data->'sourceReferences','{}')||jsonb_build_object('markate',source_ref));
   insert into crm_import.customer_import_rows(company_id,batch_id,source_id,customer_id,action,before_row,source_data,after_data)
   values(p_company,p_batch,source_id,identifier,'link',to_jsonb(before_customer),rec->'customer',payload);
   update public.customers set data=payload,updated_at=now() where id=identifier and company_id=p_company returning data into saved;
   linked:=linked+1;
  else raise exception 'Unknown import operation'; end if;
  if saved is distinct from payload then raise exception 'Customer field verification failed'; end if;
 end loop;
 if inserted<>p_expected_new or linked<>p_expected_links then raise exception 'Import count verification failed'; end if;
 if exists(select 1 from public.communication_events e join crm_import.customer_import_rows r
   on r.company_id=e.company_id and r.customer_id=e.customer_id where r.company_id=p_company and r.batch_id=p_batch
   and e.created_at>=transaction_timestamp()) then raise exception 'Import unexpectedly generated communications events'; end if;
 outcome:=jsonb_build_object('batchId',p_batch,'inserted',inserted,'linked',linked,'replayed',false,'communications',0,'sourceSha256',source_hash);
 update crm_import.customer_import_batches set status='completed',result=outcome where company_id=p_company and id=p_batch;
 return outcome;
end $$;

-- Suppress events only for an exact import-ledger row in this same transaction.
-- A forged JSON flag, source reference, or SET variable cannot bypass normal events.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('crm_private.capture_entity()'::regprocedure);
 if position('cust := case' in definition)=0 then raise exception 'Unexpected customer event trigger definition'; end if;
 definition:=replace(definition,'cust := case',$guard$
 if tg_table_name='customers' and tg_op='INSERT' and exists(
  select 1 from crm_import.customer_import_rows r join crm_import.customer_import_batches b
  on b.company_id=r.company_id and b.id=r.batch_id
  where r.company_id=new.company_id and r.customer_id=new.id and r.action='create'
   and r.after_data=new.data and b.status='running' and b.transaction_id=txid_current()
 ) then return new; end if;
 cust := case$guard$);
 execute definition;
end $migration$;

revoke all on function crm_import.assert_customer_import_actor(text,uuid),crm_import.customer_identity_keys(jsonb) from public,anon,authenticated;
grant execute on function crm_import.assert_customer_import_actor(text,uuid),crm_import.customer_identity_keys(jsonb) to service_role;
revoke all on function public.crm_customer_import_state(text,uuid),public.crm_import_markate_customers(text,uuid,uuid,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.crm_customer_import_state(text,uuid),public.crm_import_markate_customers(text,uuid,uuid,text,integer,integer,jsonb) to service_role;
