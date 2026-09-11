create index if not exists referrals_referrer_fk
  on public.referrals(referring_customer_id);
create index if not exists referrals_referred_fk
  on public.referrals(referred_customer_id);
create index if not exists coupons_customer_fk
  on public.coupons(customer_id);
