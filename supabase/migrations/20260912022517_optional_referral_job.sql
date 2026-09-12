create unique index referrals_manual_unique
  on public.referrals(company_id, referred_customer_id)
  where completed_job_id is null;

create or replace function public.crm_issue_referral(
  p_company text, p_referrer text, p_referred text, p_job text,
  p_actor uuid, p_expires timestamptz, p_notes text default ''
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
    select 1 from public.customers where id = p_referrer and company_id = p_company
  ) or not exists (
    select 1 from public.customers where id = p_referred and company_id = p_company
  ) then
    raise exception 'Customer not found.';
  end if;
  if p_job is not null and not exists (
    select 1 from public.work_orders
    where id = p_job and company_id = p_company
      and customer_id = p_referred and data->>'status' = 'Completed'
  ) then
    raise exception 'Choose a completed job for the referred customer.';
  end if;

  insert into public.referrals(
    company_id, referring_customer_id, referred_customer_id,
    completed_job_id, status, notes, created_by
  ) values (
    p_company, p_referrer, p_referred, p_job, 'qualified',
    coalesce(p_notes, ''), p_actor
  ) returning * into referral_row;

  code_value := 'AK25-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.coupons(
    company_id, customer_id, referral_id, code, amount_cents,
    status, expires_at, created_by
  ) values (
    p_company, p_referrer, referral_row.id, code_value, 2500,
    'active', p_expires, p_actor
  ) returning * into coupon_row;

  update public.referrals set status = 'rewarded', updated_at = now()
  where id = referral_row.id;
  return coupon_row;
exception
  when unique_violation then
    raise exception 'A referral reward already exists for this customer or completed job.';
end;
$$;

revoke all on function public.crm_issue_referral(
  text, text, text, text, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.crm_issue_referral(
  text, text, text, text, uuid, timestamptz, text
) to service_role;
