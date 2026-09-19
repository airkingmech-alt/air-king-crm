set local lock_timeout='5s';
set local statement_timeout='120s';

-- Soft deletion retains every financial, consent, acceptance and communication record.
-- The private trigger checks ALL related rows, including rows hidden by feature RLS.
create function crm_private.guard_record_deletion() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles%rowtype; kind text; ref_column text;
begin
 if tg_op='INSERT' then
  if new.data->>'deletedAt' is not null then raise exception 'Create the record before deleting it'; end if;
  return new;
 end if;
 if old.data->>'deletedAt' is not null then
  raise exception 'This record has been deleted. Refresh before continuing.';
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
 if tg_table_name='customers' then
  if exists(select 1 from quotes where customer_id=old.id and data->>'deletedAt' is null)
   or exists(select 1 from invoices where customer_id=old.id and data->>'deletedAt' is null)
   or exists(select 1 from work_orders where customer_id=old.id)
   or exists(select 1 from memberships where customer_id=old.id)
   or exists(select 1 from payments where customer_id=old.id)
   or exists(select 1 from coupons where customer_id=old.id)
   or exists(select 1 from referrals where referring_customer_id=old.id or referred_customer_id=old.id) then
   raise exception 'This customer has linked quotes, invoices, jobs, memberships, payments, or referrals. Keep the customer to preserve that history.';
  end if;
 elsif tg_table_name='quotes' then
  if lower(coalesce(old.data->>'status','')) in ('won','accepted')
   or exists(select 1 from quote_acceptances where quote_id=old.id)
   or exists(select 1 from work_orders where data->>'quoteId'=old.id)
   or exists(select 1 from invoices where data->>'quoteId'=old.id and data->>'deletedAt' is null) then
   raise exception 'Accepted quotes and quotes linked to jobs or invoices cannot be deleted.';
  end if;
 else
  if coalesce((old.data->>'paidAmount')::numeric,0)>0
   or lower(coalesce(old.data->>'status','')) in ('paid','partially paid')
   or exists(select 1 from payments where invoice_id=old.id)
   or exists(select 1 from checkout_attempts where invoice_id=old.id) then
   raise exception 'Invoices with payments or online payment attempts cannot be deleted. Keep the invoice for payment history.';
  end if;
  if nullif(old.data->>'quoteId','') is not null or nullif(old.data->>'workOrderId','') is not null then
   raise exception 'This invoice is linked to a quote or job. Keep it to preserve the job and equipment history.';
  end if;
 end if;
 -- Ignore other submitted changes: delete cannot be used to rewrite an amount or status.
 new.data:=old.data||jsonb_build_object('deletedAt',now(),'deletedBy',actor.id);
 if tg_table_name='invoices' then new.data:=new.data||'{"status":"Void"}'::jsonb; end if;
 if tg_table_name='quotes' then new.data:=new.data||'{"status":"Cancelled"}'::jsonb; end if;
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
revoke all on function crm_private.guard_record_deletion() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['customers','quotes','invoices'] loop
 execute format('create trigger crm_00_guard_deletion before insert or update on public.%I for each row execute function crm_private.guard_record_deletion()',t);
 end loop;
end $$;

-- Parent row locks serialize new work/payment/message creation with deletion.
create function crm_private.reject_deleted_parent() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare ref record; parent jsonb; row_json jsonb:=to_jsonb(new); identifier text;
begin
 for ref in select * from (values ('customers','customer_id','customerId'),('quotes','quote_id','quoteId'),('invoices','invoice_id','invoiceId')) as r(tab,col,jsoncol) loop
  identifier:=coalesce(row_json->>ref.col,row_json->'data'->>ref.jsoncol);
  if identifier is null then continue; end if;
  execute format('select data from public.%I where id=$1 for update',ref.tab) into parent using identifier;
  if parent->>'deletedAt' is not null then raise exception 'The related record has been deleted. Refresh before continuing.'; end if;
 end loop;
 return new;
end $$;
revoke all on function crm_private.reject_deleted_parent() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['quotes','invoices','work_orders','memberships','payments','checkout_attempts','quote_acceptances','communications','document_links'] loop
 execute format('create trigger crm_01_deleted_parent before insert on public.%I for each row execute function crm_private.reject_deleted_parent()',t);
 end loop;
end $$;

create function public.crm_delete_record(p_table text,p_id text,p_previous jsonb) returns boolean
language plpgsql security invoker set search_path=public,pg_temp set lock_timeout='5s' as $$
declare actor public.profiles%rowtype; current_data jsonb; changed text;
begin
 select * into actor from profiles where id=auth.uid();
 if actor.id is null or actor.role not in ('owner','admin') then raise exception 'Only owners and administrators can delete records'; end if;
 if p_table not in ('customers','quotes','invoices') or not public.crm_can(p_table) then raise exception 'Delete is not permitted'; end if;
 execute format('select data from public.%I where id=$1 and company_id=$2 for update',p_table) into current_data using p_id,actor.company_id;
 if current_data is null then raise exception 'Record unavailable or access restricted'; end if;
 if current_data->>'deletedAt' is not null then return true; end if;
 if current_data is distinct from p_previous then raise exception 'This record changed. Refresh and review it before deleting.'; end if;
 execute format('update public.%I set data=data||jsonb_build_object(''deletedAt'',now()) where id=$1 and company_id=$2 returning id',p_table) into changed using p_id,actor.company_id;
 if changed is null then raise exception 'Delete was not permitted'; end if;
 return true;
end $$;
revoke all on function public.crm_delete_record(text,text,jsonb) from public,anon;
grant execute on function public.crm_delete_record(text,text,jsonb) to authenticated;
