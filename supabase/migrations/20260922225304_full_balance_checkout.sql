begin;
-- Keep the balance calculation and checkout reservation under the same invoice lock.
create function public.crm_reserve_full_checkout(p_invoice text,p_company text)
returns public.checkout_attempts language plpgsql security invoker set search_path=public as $$
declare inv public.invoices; due bigint; existing public.checkout_attempts; begin
 select * into strict inv from public.invoices where id=p_invoice and company_id=p_company for update;
 if inv.data->>'deletedAt' is not null or inv.data->>'status' in ('Void','Draft','Paid') then raise exception 'Invoice is not payable'; end if;
 due := round((inv.data->>'amount')::numeric*100)-coalesce((select sum(amount_cents) from public.payments where invoice_id=p_invoice),0);
 if due is null or due<50 then raise exception 'No payable balance of at least $0.50 remains'; end if;
 select * into existing from public.checkout_attempts where invoice_id=p_invoice and state in ('reserved','open') and expires_at>now() order by created_at desc limit 1;
 if found then
  if existing.amount_cents<>due then raise exception 'Another payment is in progress. Wait for it to finish or expire.'; end if;
  return existing;
 end if;
 insert into public.checkout_attempts(company_id,invoice_id,amount_cents,expires_at)
 values(p_company,p_invoice,due,now()+interval '1 hour') returning * into existing;
 return existing;
end $$;
revoke all on function public.crm_reserve_full_checkout(text,text) from public,anon,authenticated;
grant execute on function public.crm_reserve_full_checkout(text,text) to service_role;
commit;
