set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Tighten existing policies; no record rewrites or destructive schema changes.
create or replace function public.crm_can(p_permission text) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.profiles where id=auth.uid()
   and role in ('owner','admin','technician','dispatcher')
   and (role='owner' or coalesce(permissions->p_permission,'true'::jsonb) <> 'false'::jsonb))
$$;
revoke all on function public.crm_can(text) from public,anon;
grant execute on function public.crm_can(text) to authenticated;
do $$ declare item record; begin
 for item in select * from (values
 ('customers','customers'),('customer_notes','customers'),('customer_photos','customers'),
 ('quotes','quotes'),('quote_acceptances','quotes'),('invoices','invoices'),('invoice_line_items','invoices'),('payments','invoices'),
 ('work_orders','schedule'),('memberships','memberships'),('price_book_items','pricebook'),('leads','leads'),('lead_sources','leads'),
 ('crm_settings','communications'),('customer_communication_preferences','customers'),('message_templates','communications'),
 ('automations','automations'),('automation_runs','automations'),('communications','communications'),('communication_events','communications'),
 ('referrals','referrals'),('coupons','referrals'),('marketing_audiences','marketing'),('marketing_campaigns','marketing'),
 ('marketing_campaign_steps','marketing'),('marketing_campaign_runs','marketing'),('marketing_campaign_recipients','marketing'),
 ('marketing_attributions','marketing'),('communication_consent_events','communications')) as t(tab,feature)
 loop
 execute format('create policy feature_access on public.%I as restrictive for all to authenticated using (public.crm_can(%L)) with check (public.crm_can(%L))',item.tab,item.feature,item.feature);
 end loop;
end $$;
-- Histories and campaigns can contain financial/job/customer data. Restrict cross-feature projections too.
do $$ declare tab text; begin
 foreach tab in array array['communications','communication_events','marketing_audiences','marketing_campaigns','marketing_campaign_steps','marketing_campaign_runs','marketing_campaign_recipients','marketing_attributions'] loop
 execute format('create policy related_feature_access on public.%I as restrictive for all to authenticated using (public.crm_can(''customers'') and public.crm_can(''quotes'') and public.crm_can(''invoices'') and public.crm_can(''schedule''))',tab);
 end loop;
end $$;

-- Atomic confirmed writes, under caller RLS. Comparing original JSON prevents lost edits.
create function public.crm_save_records(p_records jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare rec jsonb; tab text; identifier text; company text; old_data jsonb; saved jsonb; output jsonb:='[]';
begin
 select company_id into company from profiles where id=auth.uid() and role in ('owner','admin','technician','dispatcher');
 if company is null then raise exception 'Staff access required'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records) not between 1 and 10 then raise exception 'Invalid save request'; end if;
 for rec in select value from jsonb_array_elements(p_records) loop
  tab:=rec->>'table'; identifier:=rec->>'id';
  if tab not in ('customers','quotes','invoices','work_orders','memberships') or identifier is null or rec->'data'->>'id' is distinct from identifier then raise exception 'Invalid record'; end if;
  execute format('select data from public.%I where id=$1 and company_id=$2 for update',tab) into old_data using identifier,company;
  if old_data is not null then
   if old_data=rec->'data' then output:=output||jsonb_build_array(old_data); continue; end if;
   if rec->'previous' is null or rec->'previous'='null'::jsonb or old_data is distinct from rec->'previous' then raise exception 'This record changed. Refresh and review before saving again.'; end if;
   if old_data->>'customerId' is distinct from rec->'data'->>'customerId' then raise exception 'Customer cannot be reassigned through this save'; end if;
   execute format('update public.%I set data=$1 where id=$2 and company_id=$3 returning data',tab) into saved using rec->'data',identifier,company;
  else
   if rec->'previous' is not null and rec->'previous'<>'null'::jsonb then raise exception 'Record unavailable. Refresh before saving.'; end if;
   if tab='customers' then
    execute format('insert into public.%I(id,company_id,data) values($1,$2,$3) returning data',tab) into saved using identifier,company,rec->'data';
   else
    if tab='invoices' then
     perform pg_advisory_xact_lock(hashtextextended(company || ':invoice:' || coalesce(rec->'data'->>'quoteId',rec->'data'->>'workOrderId',identifier),0));
     if exists(select 1 from invoices where company_id=company and id<>identifier and ((rec->'data'->>'quoteId' is not null and data->>'quoteId'=rec->'data'->>'quoteId') or (rec->'data'->>'workOrderId' is not null and data->>'workOrderId'=rec->'data'->>'workOrderId'))) then
      raise exception 'An invoice already exists for this quote or job. Refresh and open that invoice.';
     end if;
    end if;
    if not exists(select 1 from customers where id=rec->'data'->>'customerId' and company_id=company) then raise exception 'Customer unavailable or access restricted'; end if;
    execute format('insert into public.%I(id,company_id,customer_id,data) values($1,$2,$3,$4) returning data',tab) into saved using identifier,company,rec->'data'->>'customerId',rec->'data';
   end if;
  end if;
  if saved is null then raise exception 'Save not permitted'; end if;
  output:=output||jsonb_build_array(saved);
 end loop;
 return output;
end $$;
revoke all on function public.crm_save_records(jsonb) from public,anon;
grant execute on function public.crm_save_records(jsonb) to authenticated;

-- Customer creation and lead linkage succeed together; retry returns the linked customer.
create function public.crm_convert_lead(p_lead_id uuid,p_customer jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare lead public.leads%rowtype; saved jsonb;
begin
 select * into lead from public.leads where id=p_lead_id and company_id=(select company_id from profiles where id=auth.uid()) for update;
 if not found then raise exception 'Lead unavailable or access restricted'; end if;
 if lead.customer_id is not null then
  select data into saved from public.customers where id=lead.customer_id and company_id=lead.company_id;
  if saved is null then raise exception 'Customer unavailable or access restricted'; end if;
  return saved;
 end if;
 saved:=public.crm_save_records(jsonb_build_array(jsonb_build_object('table','customers','id',p_customer->>'id','data',p_customer)))->0;
 update public.leads set customer_id=saved->>'id',status='qualified',converted_at=now() where id=p_lead_id;
 if not found then raise exception 'Lead update not permitted'; end if;
 return saved;
end $$;
revoke all on function public.crm_convert_lead(uuid,jsonb) from public,anon;
grant execute on function public.crm_convert_lead(uuid,jsonb) to authenticated;
