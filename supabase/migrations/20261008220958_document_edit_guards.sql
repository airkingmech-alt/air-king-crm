begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Existing rows are not rewritten. The editor is a narrow, compare-and-swap
-- entry point; the caller retains company RLS and feature permissions.
create function public.crm_edit_document(p_kind text, p_id text, p_previous jsonb, p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  company text; tab text; previous jsonb; saved jsonb; allowed text[];
begin
  if p_kind is null or p_kind not in ('quote','invoice') or nullif(p_id,'') is null
    or length(p_id)>200 or jsonb_typeof(p_previous) is distinct from 'object'
    or jsonb_typeof(p_changes) is distinct from 'object'
    or octet_length(p_changes::text)>262144 then
    raise exception 'Invalid document edit request';
  end if;
  select company_id into company from public.profiles
    where id=auth.uid() and role in ('owner','admin','technician','dispatcher');
  if company is null then raise exception 'Staff access required'; end if;
  tab:=p_kind||'s';
  if not public.crm_can(tab) then raise exception 'Document access is restricted'; end if;
  allowed:=case p_kind when 'quote' then array[
    'customerName','title','jobType','laborDescription','equipmentItems','options',
    'laborCost','materialsCost','equipmentCost','purchaseTax','taxRate','pricingVersion',
    'equipmentSelectionMode','internalReviewNote','selectedAddOns']
    else array['customerName','projectName','constructionStage','dueDate','items','amount'] end;
  if exists(select 1 from jsonb_object_keys(p_changes) k where not k=any(allowed)) then
    raise exception 'This field cannot be changed by the document editor';
  end if;
  execute format('select data from public.%I where id=$1 and company_id=$2 for update',tab)
    into previous using p_id,company;
  if previous is null or previous->>'deletedAt' is not null then
    raise exception 'Document unavailable or access restricted';
  end if;
  if previous is distinct from p_previous then
    raise exception 'This record changed. Refresh and review before saving again.';
  end if;
  if p_kind='quote' and (lower(coalesce(previous->>'status','')) in ('won','accepted') or previous ? 'acceptedScope') then
    raise exception 'Accepted scope and prices are locked. Create a draft revision and obtain approval again';
  end if;
  if p_kind='invoice' and (coalesce(previous->>'status','') not in ('Draft','Sent','Overdue')
    or coalesce((previous->>'paidAmount')::numeric,0)>0) then
    raise exception 'Paid, partially paid, or void invoice content is locked';
  end if;
  saved:=previous||p_changes;
  if p_kind='quote' and p_changes ? 'options' and jsonb_typeof(saved->'options')='array'
    and saved->>'selectedOption' is not null and not exists(
      select 1 from jsonb_array_elements(saved->'options') opt where opt->>'tier'=saved->>'selectedOption') then
    saved:=saved-'selectedOption';
  end if;
  if saved=previous then return previous; end if;
  -- The table trigger validates changed content, checks hidden payment state,
  -- and appends its own audit entry. Never accept client-supplied history.
  execute format('update public.%I set data=$1,updated_at=clock_timestamp() where id=$2 and company_id=$3 returning data',tab)
    into saved using saved,p_id,company;
  if saved is null then raise exception 'Save not permitted'; end if;
  return saved;
end $$;
revoke all on function public.crm_edit_document(text,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.crm_edit_document(text,text,jsonb,jsonb) to authenticated;

-- Checkout reservations are intentionally not readable by staff. This private
-- non-callable trigger only enforces invariants on the row already authorized
-- by caller RLS. It grants neither payment access nor a privileged editing API.
create function crm_private.guard_document_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fields text[]; changed text[]:='{}'; k text; v jsonb; item jsonb; opt jsonb; n numeric;
  sum_amount numeric:=0; history jsonb; catalog jsonb; before_snapshot jsonb; after_snapshot jsonb;
begin
  if tg_op='INSERT' then
    if new.data ? 'editHistory' and new.data->'editHistory'<>'[]'::jsonb then
      -- BEFORE INSERT also runs for an upsert of an existing audited record.
      if tg_table_name='quotes' then
        select data->'editHistory' into history from public.quotes
          where id=new.id and company_id=new.company_id;
        if history is null and current_setting('role',true) in ('service_role','none') and nullif(new.data->>'revisionOf','') is not null then
          select data->'editHistory' into history from public.quotes
            where id=new.data->>'revisionOf' and company_id=new.company_id and customer_id=new.customer_id;
        end if;
      else
        select data->'editHistory' into history from public.invoices
          where id=new.id and company_id=new.company_id;
      end if;
      if history is null or history is distinct from new.data->'editHistory' then
        raise exception 'New documents cannot supply fabricated edit history';
      end if;
    end if;
    return new;
  end if;
  if new.data->'editHistory' is distinct from old.data->'editHistory' then
    raise exception 'Document edit history is immutable and maintained by the server';
  end if;
  fields:=case tg_table_name when 'quotes' then array[
    'customerName','title','jobType','laborDescription','equipmentItems','options','selectedOption',
    'laborCost','materialsCost','equipmentCost','purchaseTax','taxRate','pricingVersion',
    'equipmentSelectionMode','internalReviewNote','selectedAddOns']
    else array['customerName','projectName','constructionStage','dueDate','items','amount'] end;
  -- Run after the existing acceptance/balance triggers so a declined quote's
  -- historical selection cannot reintroduce an option removed by this edit.
  if tg_table_name='quotes' and new.data->'options' is distinct from old.data->'options'
    and jsonb_typeof(new.data->'options')='array' and new.data->>'selectedOption' is not null
    and not exists(select 1 from jsonb_array_elements(new.data->'options') option_entry where option_entry->>'tier'=new.data->>'selectedOption') then
    new.data:=new.data-'selectedOption';
  end if;
  foreach k in array fields loop
    if new.data->k is distinct from old.data->k then changed:=array_append(changed,k); end if;
  end loop;
  -- Terminal status cannot be reset in one write to unlock content in the next.
  -- Check this even when the write changes no editor fields. The sole Void
  -- transition retained is a server-verified late payment already in the ledger:
  -- receiving money must never be discarded because an old checkout settled late.
  if tg_table_name='invoices' then
    if old.data->>'status'='Void' and new.data->>'status' is distinct from 'Void' then
      if current_setting('role',true) is distinct from 'service_role'
        or coalesce(new.data->>'status','') not in ('Paid','Partial')
        or not exists(select 1 from public.payments where invoice_id=old.id) then
        raise exception 'A void invoice cannot be reopened. Create a new invoice for new work';
      end if;
    end if;
    if (old.data->>'status' in ('Paid','Partial') or coalesce((old.data->>'paidAmount')::numeric,0)>0)
      and coalesce(new.data->>'status','') not in ('Paid','Partial') then
      raise exception 'Paid or partially paid invoices cannot be reset to an unpaid status';
    end if;
  end if;
  if cardinality(changed)=0 then return new; end if;
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id
    or new.customer_id is distinct from old.customer_id
    or new.data->'id' is distinct from old.data->'id'
    or new.data->'customerId' is distinct from old.data->'customerId' then
    raise exception 'Document identity cannot change during an edit';
  end if;
  if old.data->>'deletedAt' is not null then raise exception 'Deleted document content is locked'; end if;
  if tg_table_name='quotes' then
    if lower(coalesce(old.data->>'status','')) in ('won','accepted') or old.data ? 'acceptedScope'
      then
      raise exception 'Accepted scope and prices are locked. Create a draft revision and obtain approval again';
    end if;
    -- Approval itself is a separate audited workflow, not a document edit.
    if new.data->>'status'='Won' and new.data ? 'acceptedScope' then return new; end if;
    if exists(select 1 from public.quote_acceptances where quote_id=old.id and decision='accepted') then
      raise exception 'Accepted scope and prices are locked. Create a draft revision and obtain approval again';
    end if;
  else
    if coalesce(old.data->>'status','') not in ('Draft','Sent','Overdue')
      or coalesce((old.data->>'paidAmount')::numeric,0)>0
      or exists(select 1 from public.payments where invoice_id=old.id) then
      raise exception 'Paid, partially paid, or void invoice content is locked';
    end if;
    if changed && array['customerName','projectName','constructionStage','items','amount']
      and exists(select 1 from public.checkout_attempts where invoice_id=old.id
        and state in ('reserved','open') and (checkout_kind='direct' or expires_at>now())) then
      raise exception 'An online payment is in progress. Resume or cancel it before changing invoice scope or price';
    end if;
  end if;

  -- Validate only changed fields, preserving legacy data during unrelated edits.
  foreach k in array changed loop
    v:=new.data->k;
    if k in ('customerName','title') then
      if jsonb_typeof(v) is distinct from 'string' or length(trim(new.data->>k)) not between 1 and (case when k='title' then 2000 else 300 end) then
        raise exception 'Enter a customer name up to 300 characters and a title up to 2000 characters';
      end if;
    elsif k in ('projectName','laborDescription','internalReviewNote') then
      if jsonb_typeof(v) is distinct from 'string' or length(new.data->>k)>(case when k='projectName' then 200 else 10000 end) then
        raise exception 'Invalid document description length';
      end if;
    elsif k='jobType' then
      if jsonb_typeof(v) is distinct from 'string' or new.data->>k not in ('Changeout','Service Call','New Construction','Maintenance','Commercial') then
        raise exception 'Choose a valid job type';
      end if;
    elsif k='constructionStage' then
      if v is not null and v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or new.data->>k not in ('','Rough-in','Finish')) then
        raise exception 'Choose a valid construction stage';
      end if;
    elsif k='dueDate' then
      if jsonb_typeof(v) is distinct from 'string' or new.data->>k !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Enter a valid due date';
      end if;
      begin
        if (new.data->>k)::date not between date '1900-01-01' and date '2200-12-31' then
          raise exception 'Enter a valid due date';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Enter a valid due date'; end;
    elsif k in ('laborCost','materialsCost','equipmentCost','purchaseTax','amount') then
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'Enter a valid amount in dollars and cents'; end if;
      n:=(new.data->>k)::numeric;
      if n<0 or n>100000000 or n<>round(n,2) then raise exception 'Enter a valid amount in dollars and cents'; end if;
    elsif k='taxRate' then
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'Invalid purchase tax rate'; end if;
      n:=(new.data->>k)::numeric;
      if n<0 or n>1 or n<>round(n,6) then raise exception 'Invalid purchase tax rate'; end if;
    elsif k='pricingVersion' then
      if v is distinct from '"purchase-tax-v1"'::jsonb then raise exception 'Invalid pricing version'; end if;
    elsif k='equipmentSelectionMode' then
      if v is distinct from '"explicit"'::jsonb then raise exception 'Invalid equipment selection mode'; end if;
    elsif k in ('equipmentItems','selectedAddOns') then
      if jsonb_typeof(v) is distinct from 'array' then raise exception 'Invalid equipment or add-on selection'; end if;
      if jsonb_array_length(v)>100 or exists(select 1 from jsonb_array_elements(v) entry
        where jsonb_typeof(entry)<>'string' or length(trim(entry #>> '{}')) not between 1 and 200) then
        raise exception 'Invalid equipment or add-on selection';
      end if;
      if k='selectedAddOns' then
        if jsonb_array_length(v)>20 or (select count(*) from jsonb_array_elements(v))<>(select count(distinct value) from jsonb_array_elements(v)) then
          raise exception 'Invalid or duplicate add-on selection';
        end if;
        catalog:=coalesce(new.data->'addOnCatalog',public.crm_quote_addon_catalog());
        if jsonb_typeof(catalog) is distinct from 'array' then raise exception 'Review the quote add-on catalog'; end if;
        if exists(select 1 from jsonb_array_elements_text(v) selection where
          (select count(*) from jsonb_array_elements(catalog) entry where entry->>'id'=selection)<>1) then
          raise exception 'An add-on is unavailable in this quote';
        end if;
      end if;
    end if;
  end loop;
  if tg_table_name='invoices' then
    if changed && array['projectName','constructionStage'] and nullif(new.data->>'constructionStage','') is not null
      and nullif(trim(new.data->>'projectName'),'') is null then
      raise exception 'Enter the house address or project / lot name';
    end if;
    if changed && array['items','amount'] then
      if jsonb_typeof(new.data->'items') is distinct from 'array' or jsonb_typeof(new.data->'amount') is distinct from 'number' then
        raise exception 'Invoice items and amount are required';
      end if;
      if jsonb_array_length(new.data->'items') not between 1 and 200 then raise exception 'Include 1 to 200 invoice items'; end if;
      for item in select value from jsonb_array_elements(new.data->'items') loop
        if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'description') is distinct from 'string'
          or length(trim(item->>'description')) not between 1 and 2000
          or jsonb_typeof(item->'amount') is distinct from 'number' then raise exception 'Invalid invoice item'; end if;
        n:=(item->>'amount')::numeric;
        if n<0 or n>100000000 or n<>round(n,2) then raise exception 'Enter invoice item amounts in dollars and cents'; end if;
        sum_amount:=sum_amount+n;
      end loop;
      if sum_amount<>(new.data->>'amount')::numeric or sum_amount>100000000 then
        raise exception 'Invoice item total must equal the invoice amount';
      end if;
    end if;
  elsif 'options'=any(changed) then
    if jsonb_typeof(new.data->'options') is distinct from 'array' then raise exception 'Invalid quote options'; end if;
    if jsonb_array_length(new.data->'options') not between 1 and 3 then raise exception 'Include 1 to 3 quote options'; end if;
    if (select count(*) from jsonb_array_elements(new.data->'options'))<>(select count(distinct lower(value->>'tier')) from jsonb_array_elements(new.data->'options')) then
      raise exception 'Each quote option must have a unique tier';
    end if;
    for opt in select value from jsonb_array_elements(new.data->'options') loop
      if jsonb_typeof(opt)<>'object' or lower(coalesce(opt->>'tier','')) not in ('good','better','best')
        or jsonb_typeof(opt->'label') is distinct from 'string' or length(trim(opt->>'label')) not between 1 and 200
        or jsonb_typeof(opt->'customerPrice') is distinct from 'number' then raise exception 'Invalid quote option'; end if;
      foreach k in array array['customerPrice','totalCost','equipmentCost','purchaseTax'] loop
        if opt ? k then
          if jsonb_typeof(opt->k)<>'number' then raise exception 'Invalid quote option amount'; end if;
          n:=(opt->>k)::numeric;
          if n<0 or n>100000000 or n<>round(n,2) then raise exception 'Enter quote option amounts in dollars and cents'; end if;
        end if;
      end loop;
      foreach k in array array['equipment','equipmentSummary','efficiency'] loop
        if opt ? k and (jsonb_typeof(opt->k)<>'string' or length(opt->>k)>(case when k='efficiency' then 2000 else 10000 end)) then raise exception 'Invalid quote option description'; end if;
      end loop;
      foreach k in array array['equipmentItems','features'] loop
        if opt ? k then
          if jsonb_typeof(opt->k)<>'array' then raise exception 'Invalid quote option equipment or features'; end if;
          if jsonb_array_length(opt->k)>100 or exists(select 1 from jsonb_array_elements(opt->k) entry
            where jsonb_typeof(entry)<>'string' or length(trim(entry #>> '{}')) not between 1 and (case when k='features' then 10000 else 2000 end)) then
            raise exception 'Invalid quote option equipment or features';
          end if;
        end if;
      end loop;
    end loop;
  end if;
  history:=coalesce(old.data->'editHistory','[]'::jsonb);
  if jsonb_typeof(history)<>'array' then raise exception 'Existing edit history needs review before editing'; end if;
  before_snapshot:=old.data-'editHistory'; after_snapshot:=new.data-'editHistory';
  new.data:=new.data||jsonb_build_object('editHistory',history||jsonb_build_array(jsonb_build_object(
    'editedAt',clock_timestamp(),'editedBy',auth.uid(),'actorRole',current_setting('role',true),
    'changedFields',to_jsonb(changed),'before',before_snapshot,'after',after_snapshot)));
  new.updated_at:=clock_timestamp();
  return new;
end $$;
revoke all on function crm_private.guard_document_edit() from public,anon,authenticated,service_role;
create trigger crm_zz_document_edit before insert or update on public.quotes
  for each row execute function crm_private.guard_document_edit();
create trigger crm_zz_document_edit before insert or update on public.invoices
  for each row execute function crm_private.guard_document_edit();
commit;
