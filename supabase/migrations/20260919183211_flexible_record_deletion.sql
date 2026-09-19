set local lock_timeout='5s';
set local statement_timeout='120s';

-- Deletion hides the selected record; it never erases or cascades linked history.
create or replace function crm_private.guard_record_deletion() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles%rowtype; kind text; ref_column text;
begin
 if tg_op='INSERT' then
  if new.data->>'deletedAt' is not null then raise exception 'Create the record before deleting it'; end if;
  return new;
 end if;
 if old.data->>'deletedAt' is not null then
  -- Caller edits cannot change a deleted record; internal settlement and the
  -- existing job-completion service-date sync may still maintain its history.
  if auth.uid() is not null and not (tg_table_name='customers' and
    (new.data-'lastServiceAt')=(old.data-'lastServiceAt')) then
   raise exception 'This record has been deleted. Refresh before continuing.';
  end if;
  -- Keep the tombstone during historical updates and late Stripe settlement.
  new.data:=new.data||jsonb_build_object('deletedAt',old.data->'deletedAt','deletedBy',old.data->'deletedBy');
  return new;
 end if;
 if new.data->>'deletedAt' is null then return new; end if;
 select * into actor from profiles where id=auth.uid();
 if actor.id is null or actor.company_id<>old.company_id or actor.role not in ('owner','admin')
    or (actor.role<>'owner' and coalesce(actor.permissions->tg_table_name,'true'::jsonb)='false'::jsonb) then
  raise exception 'Only an owner or administrator with access can delete this record';
 end if;
 kind:=case tg_table_name when 'customers' then 'customer' when 'quotes' then 'quote' else 'invoice' end;
 ref_column:=kind||'_id';
 -- Serialize deletion against message claims, so an in-flight send is never silently discarded.
 lock table public.communications in share row exclusive mode;
 if exists(select 1 from communications c where c.company_id=old.company_id and to_jsonb(c)->>ref_column=old.id and c.status='sending') then
  raise exception 'A message is being sent for this record. Wait a moment and try again.';
 end if;
 -- Ignore other submitted changes: delete cannot be used to rewrite an amount or status.
 new.data:=old.data||jsonb_build_object('deletedAt',now(),'deletedBy',actor.id);
 update communications c set status='cancelled',error='Related record deleted',updated_at=now()
  where c.company_id=old.company_id and to_jsonb(c)->>ref_column=old.id and c.status='pending';
 update automation_runs r set status='stopped',error='Related record deleted',lease_until=null,claim_token=null,updated_at=now()
  from communication_events e where r.event_id=e.id and e.company_id=old.company_id
  and to_jsonb(e)->>ref_column=old.id and r.status in ('waiting','processing');
 if tg_table_name<>'customers' then
  update document_links l set revoked_at=now() where l.company_id=old.company_id and to_jsonb(l)->>ref_column=old.id and revoked_at is null;
 end if;
 insert into communication_events(company_id,customer_id,quote_id,invoice_id,event_type,actor_id,metadata)
 values(old.company_id,case when tg_table_name='customers' then old.id else to_jsonb(old)->>'customer_id' end,
 case when tg_table_name='quotes' then old.id end,case when tg_table_name='invoices' then old.id end,
 kind||'.deleted',actor.id,jsonb_build_object('record_id',old.id,'previous_status',old.data->>'status'));
 return new;
end $$;

-- Historical invoices/jobs and verified Stripe settlements may reference a deleted
-- customer or quote. New public links, messages, acceptances and checkouts remain blocked.
drop trigger crm_01_deleted_parent on public.payments;
drop trigger crm_01_deleted_parent on public.work_orders;
drop trigger crm_01_deleted_parent on public.memberships;
drop trigger crm_01_deleted_parent on public.invoices;
drop trigger crm_01_deleted_parent on public.quotes;

-- Permit replacement invoices from a quote/job after explicitly deleting the old one.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.crm_save_records(jsonb)'::regprocedure);
 definition:=replace(definition,'from invoices where company_id=company and id<>identifier and (',
  'from invoices where company_id=company and id<>identifier and data->>''deletedAt'' is null and (');
 execute definition;
end $$;
