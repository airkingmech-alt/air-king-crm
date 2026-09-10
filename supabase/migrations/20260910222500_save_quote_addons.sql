set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop function if exists public.crm_decide_quote(text,text,text,text,text,text,text);

create function public.crm_decide_quote(
  p_quote text,
  p_company text,
  p_name text,
  p_decision text,
  p_signature text,
  p_option text,
  p_message text,
  p_addons jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare q public.quotes; opt jsonb; result public.quote_acceptances; wo text; selection jsonb;
begin
  select * into strict q from public.quotes where id=p_quote and company_id=p_company for update;
  select * into result from public.quote_acceptances where quote_id=p_quote;
  if found then return to_jsonb(result); end if;
  if q.data->>'status' in ('Won','Lost','Expired','Cancelled') then raise exception 'This quote is already closed'; end if;
  if nullif(q.data->>'expiresAt','')::timestamptz < now() then raise exception 'This quote has expired'; end if;
  if length(trim(p_name))<2 or p_decision not in ('accepted','declined') then raise exception 'Name and decision are required'; end if;
  if jsonb_typeof(p_addons) <> 'array' or jsonb_array_length(p_addons) > 20 then raise exception 'Invalid add-on selection'; end if;
  select value into opt from jsonb_array_elements(q.data->'options') where value->>'tier'=p_option;
  if p_decision='accepted' and (opt is null or length(trim(p_signature))<2) then raise exception 'Choose an option and provide your signature'; end if;
  selection := q.data || jsonb_build_object('selectedOption',p_option,'selectedAddOns',p_addons);
  insert into public.quote_acceptances(company_id,quote_id,customer_name,decision,signature,selected_option,message,snapshot)
  values(p_company,p_quote,p_name,p_decision,p_signature,p_option,p_message,selection) returning * into result;
  update public.quotes set data=data||jsonb_build_object('status',case when p_decision='accepted' then 'Won' else 'Lost' end,'selectedOption',p_option,'selectedAddOns',p_addons,case when p_decision='accepted' then 'acceptedAt' else 'declinedAt' end,now()),updated_at=now() where id=p_quote;
  if p_decision='accepted' and not exists(select 1 from public.work_orders where company_id=p_company and data->>'quoteId'=p_quote) then
    wo := 'wo-'||gen_random_uuid();
    insert into public.work_orders(id,company_id,customer_id,data) values(wo,p_company,q.customer_id,jsonb_build_object('id',wo,'customerId',q.customer_id,'customerName',q.data->>'customerName','quoteId',p_quote,'selectedOption',p_option,'selectedAddOns',p_addons,'type',q.data->>'jobType','property','TBD','description',q.data->>'title','status','Unscheduled','priority','Normal'));
  end if;
  return to_jsonb(result);
end $$;

revoke all on function public.crm_decide_quote(text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_decide_quote(text,text,text,text,text,text,text,jsonb) to service_role;
