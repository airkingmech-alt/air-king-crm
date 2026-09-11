begin;

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  referring_customer_id text not null references public.customers(id),
  referred_customer_id text not null references public.customers(id),
  completed_job_id text references public.work_orders(id),
  status text not null default 'qualified'
    check (status in ('pending', 'qualified', 'rewarded', 'cancelled')),
  notes text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referring_customer_id <> referred_customer_id),
  unique (company_id, referred_customer_id, completed_job_id)
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  customer_id text not null references public.customers(id),
  referral_id uuid references public.referrals(id),
  code text not null,
  description text not null default '$25 off your next service',
  amount_cents bigint not null default 2500 check (amount_cents > 0),
  status text not null default 'active'
    check (status in ('active', 'used', 'expired', 'void')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  emailed_at timestamptz,
  reminder_sent_at timestamptz,
  used_at timestamptz,
  used_invoice_id text references public.invoices(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (referral_id)
);

create index referrals_referrer
  on public.referrals(company_id, referring_customer_id, created_at desc);
create index referrals_referred
  on public.referrals(company_id, referred_customer_id, created_at desc);
create index referrals_completed_job
  on public.referrals(completed_job_id);
create index coupons_status
  on public.coupons(company_id, status, expires_at);
create index coupons_customer
  on public.coupons(company_id, customer_id, created_at desc);
create index coupons_used_invoice
  on public.coupons(used_invoice_id);

alter table public.communication_events
  add column coupon_id uuid references public.coupons(id);
alter table public.communications
  add column coupon_id uuid references public.coupons(id);
create index communication_events_coupon
  on public.communication_events(coupon_id);
create index communications_coupon
  on public.communications(coupon_id);

alter table public.referrals enable row level security;
alter table public.coupons enable row level security;
revoke all on public.referrals, public.coupons from anon, authenticated;
grant all on public.referrals, public.coupons to service_role;
grant select on public.referrals, public.coupons to authenticated;
create policy company_read on public.referrals
  for select to authenticated
  using (company_id = public.get_my_company_id());
create policy company_read on public.coupons
  for select to authenticated
  using (company_id = public.get_my_company_id());

create function public.crm_issue_referral(
  p_company text,
  p_referrer text,
  p_referred text,
  p_job text,
  p_actor uuid,
  p_expires timestamptz,
  p_notes text default ''
)
returns public.coupons
language plpgsql
security invoker
set search_path = public
as $$
declare
  referral_row public.referrals;
  coupon_row public.coupons;
  code_value text;
begin
  if p_referrer = p_referred then
    raise exception 'Choose two different customers.';
  end if;
  if not exists (
    select 1 from public.customers
    where id = p_referrer and company_id = p_company
  ) or not exists (
    select 1 from public.customers
    where id = p_referred and company_id = p_company
  ) then
    raise exception 'Customer not found.';
  end if;
  if not exists (
    select 1 from public.work_orders
    where id = p_job
      and company_id = p_company
      and customer_id = p_referred
      and data->>'status' = 'Completed'
  ) then
    raise exception 'Choose a completed job for the referred customer.';
  end if;

  insert into public.referrals(
    company_id, referring_customer_id, referred_customer_id,
    completed_job_id, status, notes, created_by
  ) values (
    p_company, p_referrer, p_referred, p_job, 'qualified',
    coalesce(p_notes, ''), p_actor
  )
  returning * into referral_row;

  code_value := 'AK25-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.coupons(
    company_id, customer_id, referral_id, code, amount_cents,
    status, expires_at, created_by
  ) values (
    p_company, p_referrer, referral_row.id, code_value, 2500,
    'active', p_expires, p_actor
  )
  returning * into coupon_row;

  update public.referrals
  set status = 'rewarded', updated_at = now()
  where id = referral_row.id;
  return coupon_row;
exception
  when unique_violation then
    raise exception 'A referral reward already exists for this completed job.';
end;
$$;
revoke all on function public.crm_issue_referral(
  text, text, text, text, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.crm_issue_referral(
  text, text, text, text, uuid, timestamptz, text
) to service_role;

insert into public.message_templates(
  company_id, name, purpose, description, channel, category,
  subject, body, active
)
select
  company_id,
  'Referral reward â Email',
  'referral_coupon',
  'Editable $25 referral thank-you coupon',
  'email',
  'transactional',
  'Thank you for referring a neighbor to Air King!',
  'Hi {{customer_first_name}},

Thank you for referring {{referred_customer_name}} to Air King Mechanical Services. We truly appreciate your trust and support.

REFERRAL REWARD
{{coupon_amount}} OFF YOUR NEXT SERVICE
Coupon code: {{coupon_code}}
Expires: {{coupon_expires}}

Mention this code when scheduling your next service. This coupon may be used once and cannot be combined with another offer.

Thank you for supporting a local, family-owned company!',
  true
from public.crm_settings;

insert into public.message_templates(
  company_id, name, purpose, description, channel, category,
  subject, body, active
)
select
  company_id,
  'Unused referral coupon reminder â Email',
  'coupon_reminder',
  'Editable follow-up for an unused referral coupon',
  'email',
  'marketing',
  'Your Air King $25 coupon is still available',
  'Hi {{customer_first_name}},

Your {{coupon_amount}} Air King referral reward is still available. Use code {{coupon_code}} before {{coupon_expires}} and save on your next service.

Call us when you are ready to schedule. We would be glad to help keep your home comfortable.

This offer may be used once and cannot be combined with another offer.',
  true
from public.crm_settings;

insert into public.automations(
  company_id, name, description, enabled, trigger,
  conditions, steps, stop_conditions
)
select
  s.company_id,
  'Unused referral coupon follow-up',
  'Send one editable email 30 days after a referral coupon is issued, only if it remains unused.',
  false,
  'coupon.issued',
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'action', 'email',
    'wait_minutes', 43200,
    'template_id', t.id,
    'conditions', jsonb_build_array(jsonb_build_object(
      'field', 'coupon_unused', 'op', 'eq', 'value', true
    ))
  )),
  jsonb_build_array(jsonb_build_object(
    'field', 'coupon_unused', 'op', 'eq', 'value', false
  ))
from public.crm_settings s
join public.message_templates t
  on t.company_id = s.company_id
 and t.purpose = 'coupon_reminder'
 and t.channel = 'email'
where not exists (
  select 1 from public.automations a
  where a.company_id = s.company_id
    and a.name = 'Unused referral coupon follow-up'
);

commit;
