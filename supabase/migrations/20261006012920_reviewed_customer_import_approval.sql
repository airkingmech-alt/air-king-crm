-- A reviewed collision is an exact, private, create-only batch approval.
-- Only an operational database owner can record one; the application cannot
-- insert, edit, or delete approvals and no browser receives access.
create table crm_import.customer_import_approvals (
 company_id text not null, batch_id uuid not null, actor_id uuid not null,
 expected_snapshot text not null check(expected_snapshot ~ '^[a-f0-9]{32}$'),
 records jsonb not null check(jsonb_typeof(records)='array' and jsonb_array_length(records) between 1 and 1000),
 raw_source_records jsonb not null check(jsonb_typeof(raw_source_records)='array' and jsonb_array_length(raw_source_records)=jsonb_array_length(records)),
 email_corrections jsonb not null check(jsonb_typeof(email_corrections)='array'),
 approval_note text not null check(length(btrim(approval_note))>0),
 approved_at timestamptz not null default now(),
 primary key(company_id,batch_id)
);
alter table crm_import.customer_import_approvals enable row level security;
revoke all on crm_import.customer_import_approvals from public,anon,authenticated,service_role;
grant select on crm_import.customer_import_approvals to service_role;

create function crm_import.has_reviewed_create_approval(
 p_company text,p_actor uuid,p_batch uuid,p_snapshot text,p_records jsonb
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists(select 1 from crm_import.customer_import_approvals a
  where a.company_id=p_company and a.batch_id=p_batch and a.actor_id=p_actor
   and a.expected_snapshot=p_snapshot and a.records=p_records
   and not exists(select 1 from jsonb_array_elements(p_records) r
    where r->>'mode' is distinct from 'create' or r ? 'customerId'));
$$;
revoke all on function crm_import.has_reviewed_create_approval(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function crm_import.has_reviewed_create_approval(text,uuid,uuid,text,jsonb) to service_role;

-- Keep the validated importer and exact-ledger no-send trigger unchanged except
-- for this reviewed identity exception. Every other field/count/source check runs.
do $migration$
declare definition text; actor_guard text := 'perform crm_import.assert_customer_import_actor(p_company,p_actor);';
 duplicate_guard text := 'if conflicts>0 then raise exception ''Possible duplicate customer. Review identity before importing''; end if;';
begin
 definition:=pg_get_functiondef('public.crm_import_markate_customers(text,uuid,uuid,text,integer,integer,jsonb)'::regprocedure);
 if position(actor_guard in definition)=0 or position(duplicate_guard in definition)=0 then
  raise exception 'Unexpected customer import definition';
 end if;
 definition:=replace(definition,actor_guard,actor_guard||$guard$
 if exists(select 1 from crm_import.customer_import_approvals a where a.company_id=p_company and a.batch_id=p_batch)
  and not crm_import.has_reviewed_create_approval(p_company,p_actor,p_batch,p_expected_snapshot,p_records) then
  raise exception 'Reviewed approval does not match the exact actor, snapshot, and create payload';
 end if;
 $guard$);
 definition:=replace(definition,duplicate_guard,$guard$
 if conflicts>0 and not crm_import.has_reviewed_create_approval(p_company,p_actor,p_batch,p_expected_snapshot,p_records) then
  raise exception 'Possible duplicate customer. Review identity before importing';
 end if;
 $guard$);
 execute definition;
end $migration$;
