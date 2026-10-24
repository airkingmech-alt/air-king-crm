-- Read-only projections. Original customer links, messages and consent are untouched.
-- Only the authenticated Express server may call these company-scoped functions.
create function public.crm_text_phone(value text) returns text
language sql immutable parallel safe set search_path = public as $$
  with n as (select regexp_replace(coalesce(value,''),'[^0-9]','','g') as digits),
  p as (select case when length(digits)=10 then '+1'||digits else '+'||digits end as phone from n)
  select case when phone ~ '^\+[1-9][0-9]{7,14}$' then phone end from p;
$$;
create index communications_text_phone_idx on public.communications
  (company_id, public.crm_text_phone(recipient), created_at desc, id desc) where channel='sms';
create index events_text_phone_idx on public.communication_events
  (company_id, public.crm_text_phone(metadata->>'from'), created_at desc, id desc)
  where channel='sms' and event_type in ('sms.received','customer.opted_out');

create function public.crm_text_matches(p_company text,p_phone text)
returns table(id text,name text,is_primary boolean,total_count bigint)
language sql stable security invoker set search_path = public as $$
  select c.id,coalesce(nullif(trim(c.data->>'name'),''),'Unnamed customer'),
    crm_text_phone(coalesce((select x->>'phone' from jsonb_array_elements(c.data->'contacts') x
      where x->>'role'='Primary' limit 1),c.data->'contacts'->0->>'phone'))=p_phone,
    count(*) over()
  from customers c where c.company_id=p_company and coalesce(c.data->>'deletedAt','')=''
    and exists(select 1 from jsonb_array_elements(c.data->'contacts') x where crm_text_phone(x->>'phone')=p_phone)
  order by c.id limit 21;
$$;

create function public.crm_text_rows(p_company text)
returns table(key text,id uuid,phone text,direction text,customer_id text,body text,status text,
  provider_status text,error text,created_at timestamptz,scheduled_at timestamptz,read_at timestamptz,ambiguous boolean)
language sql stable security invoker as $$
  select 'out:'||m.id,m.id,coalesce(public.crm_text_phone(m.recipient),nullif(m.recipient,''),'unknown:'||m.id),
    'outbound',m.customer_id,m.body,m.status,m.provider_status,m.error,m.created_at,m.scheduled_at,null::timestamptz,false
  from public.communications m where m.company_id=p_company and m.channel='sms'
  union all
  select 'in:'||e.id,e.id,coalesce(public.crm_text_phone(e.metadata->>'from'),nullif(e.metadata->>'from',''),'unknown:'||e.id),
    'inbound',e.customer_id,e.metadata->>'body',case when e.event_type='customer.opted_out' then 'opted_out' else 'received' end,
    null,null,e.created_at,null,e.read_at,coalesce(e.metadata->>'ambiguous','false')='true'
  from public.communication_events e where e.company_id=p_company and e.channel='sms'
    and e.event_type in ('sms.received','customer.opted_out');
$$;

create function public.crm_text_conversations(p_company text,p_before_at timestamptz default null,p_before_phone text default '')
returns table(phone text,last_at timestamptz,preview text,unread_count bigint,customers jsonb)
language sql stable security invoker set search_path = public as $$
  with grouped as (
    select r.phone,max(r.created_at) last_at,count(*) filter(where r.direction='inbound' and r.read_at is null) unread_count
    from crm_text_rows(p_company) r group by r.phone
  ), page as (
    select * from grouped g where p_before_at is null or (g.last_at,g.phone)<(p_before_at,p_before_phone)
    order by last_at desc,phone desc limit 31
  )
  select p.phone,p.last_at,left(latest.body,120),p.unread_count,
    coalesce((select jsonb_agg(to_jsonb(c)) from crm_text_matches(p_company,p.phone) c),'[]'::jsonb)
  from page p left join lateral (select r.body from crm_text_rows(p_company) r where r.phone=p.phone
    order by r.created_at desc,r.key desc limit 1) latest on true
  order by p.last_at desc,p.phone desc;
$$;

create function public.crm_text_history(p_company text,p_phone text,p_before_at timestamptz default null,p_before_key text default '')
returns table(key text,id uuid,phone text,direction text,customer_id text,body text,status text,
  provider_status text,error text,created_at timestamptz,scheduled_at timestamptz,read_at timestamptz,ambiguous boolean)
language sql stable security invoker set search_path = public as $$
  select r.* from crm_text_rows(p_company) r where r.phone=p_phone
    and (p_before_at is null or (r.created_at,r.key)<(p_before_at,p_before_key))
  order by r.created_at desc,r.key desc limit 51;
$$;

revoke all on function public.crm_text_phone(text) from public,anon,authenticated;
grant execute on function public.crm_text_phone(text) to service_role;

revoke all on function public.crm_text_matches(text,text) from public,anon,authenticated;
grant execute on function public.crm_text_matches(text,text) to service_role;

revoke all on function public.crm_text_rows(text) from public,anon,authenticated;
grant execute on function public.crm_text_rows(text) to service_role;

revoke all on function public.crm_text_conversations(text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.crm_text_conversations(text,timestamptz,text) to service_role;

revoke all on function public.crm_text_history(text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.crm_text_history(text,text,timestamptz,text) to service_role;
