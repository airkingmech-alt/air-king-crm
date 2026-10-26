begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
-- Serialize the cutover with writers; existing document JSON is never rewritten.
lock table public.invoices, public.quotes in share row exclusive mode;
create table crm_private.document_number_counters (
  company_id text not null,
  kind text not null check (kind in ('invoices','quotes')),
  last_value bigint not null check (last_value >= 0),
  primary key (company_id,kind)
);
alter table crm_private.document_number_counters enable row level security;
revoke all on crm_private.document_number_counters from public,anon,authenticated,service_role;
-- Reserve existing numeric references, including soft-deleted documents.
insert into crm_private.document_number_counters(company_id,kind,last_value)
select company_id,kind,max(case when reference ~ '^[0-9]+$' then reference::bigint else 0 end)
from (
 select company_id,'invoices' kind,coalesce(nullif(data->>'documentNumber',''),id) reference from public.invoices
 union all
 select company_id,'quotes',coalesce(nullif(data->>'documentNumber',''),id) from public.quotes
) existing group by company_id,kind;
create unique index invoices_document_number_unique on public.invoices
 (company_id,(coalesce(nullif(data->>'documentNumber',''),id)));
create unique index quotes_document_number_unique on public.quotes
 (company_id,(coalesce(nullif(data->>'documentNumber',''),id)));

-- Non-callable private trigger. RLS still authorizes the original document write;
-- definer access is needed only for the private counter, never a public RPC.
create function crm_private.assign_document_number() returns trigger
language plpgsql security definer set search_path = '' as $$
declare existing jsonb; n bigint;
begin
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
   raise exception 'Document identity cannot be changed';
  end if;
  if new.data ? 'documentNumber' and new.data->'documentNumber' is distinct from old.data->'documentNumber' then
   raise exception 'Document number cannot be changed';
  end if;
  -- Older clients may omit the new field; preserve its authoritative value.
  new.data := new.data - 'documentNumber';
  if old.data ? 'documentNumber' then
   new.data := new.data || jsonb_build_object('documentNumber',old.data->'documentNumber');
  end if;
  return new;
 end if;
 -- ON CONFLICT also fires BEFORE INSERT. Never allocate again for an existing ID.
 execute format('select data from public.%I where id=$1 and company_id=$2',tg_table_name)
  into existing using new.id,new.company_id;
 if existing is not null then
  new.data := new.data - 'documentNumber';
  if existing ? 'documentNumber' then
   new.data := new.data || jsonb_build_object('documentNumber',existing->'documentNumber');
  end if;
  return new;
 end if;
 insert into crm_private.document_number_counters as counters(company_id,kind,last_value)
 values(new.company_id,tg_table_name,1)
 on conflict(company_id,kind) do update set last_value=counters.last_value+1
 returning last_value into n;
 -- Padding is a minimum width: never truncate or wrap after 999999.
 new.data := (new.data-'documentNumber') || jsonb_build_object('documentNumber',lpad(n::text,greatest(6,length(n::text)),'0'));
 return new;
end $$;
revoke all on function crm_private.assign_document_number() from public,anon,authenticated,service_role;
create trigger crm_00_document_number before insert or update on public.invoices
 for each row execute function crm_private.assign_document_number();
create trigger crm_00_document_number before insert or update on public.quotes
 for each row execute function crm_private.assign_document_number();

-- Preserve all intervening save-RPC fixes. Lock identical creates before reading,
-- and compare retries without the server-added field. Changed payloads still fail.
do $$ declare definition text; updated text; begin
 definition := pg_get_functiondef('public.crm_save_records(jsonb)'::regprocedure);
 updated := replace(definition,
  '  execute format(''select data from public.%I where id=$1 and company_id=$2 for update'',tab)',
  '  if tab in (''invoices'',''quotes'') then
   perform pg_advisory_xact_lock(hashtextextended(company || '':document-create:'' || tab || '':'' || identifier,0));
  end if;
  execute format(''select data from public.%I where id=$1 and company_id=$2 for update'',tab)');
 if updated=definition then raise exception 'Unexpected crm_save_records lock definition'; end if;
 definition := updated;
 updated := replace(definition,
  'if old_data=rec->''data'' then',
  'if old_data=rec->''data'' or (tab in (''invoices'',''quotes'') and (rec->''previous'' is null or rec->''previous''=''null''::jsonb) and not (rec->''data'' ? ''documentNumber'') and old_data-''documentNumber''=rec->''data'') then');
 if updated=definition then raise exception 'Unexpected crm_save_records retry definition'; end if;
 execute updated;
end $$;
commit;
