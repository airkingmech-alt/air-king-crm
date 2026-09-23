begin;
alter table public.checkout_attempts
 add column checkout_kind text not null default 'hosted' check(checkout_kind in ('hosted','direct')),
 add column payment_intent_id text unique,
 add column confirmation_token text unique;

create function public.crm_reserve_direct_payment(p_invoice text,p_company text,p_amount bigint,p_fee bigint,p_token text)
returns public.checkout_attempts language plpgsql security invoker set search_path=public as $$
declare inv public.invoices; due bigint; a public.checkout_attempts; begin
 select * into strict inv from public.invoices where id=p_invoice and company_id=p_company for update;
 select * into a from public.checkout_attempts where confirmation_token=p_token;
 if found then
  if a.invoice_id<>p_invoice or a.company_id<>p_company or a.amount_cents<>p_amount or a.fee_cents<>p_fee then raise exception 'Payment reference conflict'; end if;
  return a;
 end if;
 if inv.data->>'deletedAt' is not null or inv.data->>'status' in ('Void','Draft','Paid') then raise exception 'Invoice is not payable'; end if;
 due:=round((inv.data->>'amount')::numeric*100)-coalesce((select sum(amount_cents) from public.payments where invoice_id=p_invoice),0);
 if p_amount is null or due is null or due<50 or due<>p_amount then raise exception 'The invoice balance changed. Review the payment again.'; end if;
 if p_fee is null or p_fee<0 or p_fee>round(due::numeric*300/10000) or p_token is null or p_token !~ '^ctoken_[a-zA-Z0-9]+$' then raise exception 'Invalid payment review'; end if;
 if exists(select 1 from public.checkout_attempts where invoice_id=p_invoice and state in ('reserved','open') and expires_at>now()) then raise exception 'Another payment is in progress. Resume or cancel it before starting another payment.'; end if;
 -- Native intents must be cancelled at Stripe before releasing the invoice lock.
 -- A clock timeout alone must never allow a competing cash payment or second charge.
 insert into public.checkout_attempts(company_id,invoice_id,amount_cents,fee_cents,surcharge_basis_points,checkout_kind,confirmation_token,expires_at)
 values(p_company,p_invoice,due,p_fee,300,'direct',p_token,'infinity') returning * into a;
 return a;
end $$;
revoke all on function public.crm_reserve_direct_payment(text,text,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.crm_reserve_direct_payment(text,text,bigint,bigint,text) to service_role;
commit;
