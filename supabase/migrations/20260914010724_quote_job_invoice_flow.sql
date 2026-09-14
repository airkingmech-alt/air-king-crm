set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.crm_staff_convert_quote(
  p_company text,
  p_actor uuid,
  p_quote text,
  p_option text,
  p_addons jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare q public.quotes; profile_role text; opt jsonb; existing_job text; wo text; property_address text;
begin
  select role into profile_role from public.profiles where id=p_actor and company_id=p_company;
  if profile_role not in ('owner','admin','dispatcher','technician') then raise exception 'Staff access required'; end if;
  select * into strict q from public.quotes where id=p_quote and company_id=p_company for update;
  if q.data->>'status' in ('Lost','Expired','Cancelled','Declined') then
    raise exception 'This quote cannot be converted';
  end if;
  if jsonb_typeof(p_addons)<>'array' or jsonb_array_length(p_addons)>20 then raise exception 'Invalid add-on selection'; end if;
  select value into opt from jsonb_array_elements(coalesce(q.data->'options','[]'::jsonb)) where value->>'tier'=p_option;
  if opt is null then raise exception 'Choose the approved option'; end if;
  select id into existing_job from public.work_orders where company_id=p_company and data->>'quoteId'=p_quote order by created_at limit 1;
  if existing_job is null then
    select coalesce(data#>>'{properties,0,address}','TBD') into property_address
    from public.customers where id=q.customer_id and company_id=p_company;
    wo := 'wo-'||gen_random_uuid();
    insert into public.work_orders(id,company_id,customer_id,data)
    values(wo,p_company,q.customer_id,jsonb_build_object(
      'id',wo,'customerId',q.customer_id,'customerName',q.data->>'customerName',
      'quoteId',p_quote,'selectedOption',p_option,'selectedAddOns',p_addons,
      'type',coalesce(q.data->>'jobType','Installation'),'property',coalesce(property_address,'TBD'),
      'description',coalesce(q.data->>'title','Accepted quote'),'status','Unscheduled','priority','Normal',
      'conversionSource','Staff','convertedAt',now(),'convertedBy',p_actor
    ));
    existing_job := wo;
  end if;
  update public.quotes set data=data||jsonb_build_object(
    'status','Won','selectedOption',p_option,'selectedAddOns',p_addons,
    'staffAcceptedAt',coalesce(data->'staffAcceptedAt',to_jsonb(now())),
    'convertedWorkOrderId',existing_job
  ),updated_at=now() where id=p_quote;
  return jsonb_build_object('quote_id',p_quote,'job_id',existing_job,'status','Won');
end $$;

revoke all on function public.crm_staff_convert_quote(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_staff_convert_quote(text,uuid,text,text,jsonb) to service_role;
