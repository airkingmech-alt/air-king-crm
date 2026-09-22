begin;
alter table public.checkout_attempts add column surcharge_basis_points integer check(surcharge_basis_points in (0,300));
-- Existing attempts must retain the zero-fee checkout they already opened.
update public.checkout_attempts set surcharge_basis_points=0;
create function public.crm_reserve_surcharge_checkout(p_invoice text,p_company text,p_surcharge_basis_points integer)
returns public.checkout_attempts language plpgsql security invoker set search_path=public as $$
declare a public.checkout_attempts; begin
 if p_surcharge_basis_points is null or p_surcharge_basis_points not in (0,300) then raise exception 'Invalid surcharge cap'; end if;
 select * into a from public.crm_reserve_full_checkout(p_invoice,p_company);
 -- The full-balance function holds the invoice lock until this transaction ends.
 if a.surcharge_basis_points is null then
  update public.checkout_attempts set surcharge_basis_points=p_surcharge_basis_points where id=a.id returning * into a;
 end if;
 return a;
end $$;
create function public.crm_record_surcharge_payment(p_invoice text,p_company text,p_amount bigint,p_method text,p_external text,p_attempt uuid,p_event text,p_event_type text,p_fee bigint,p_receipt text)
returns public.payments language plpgsql security invoker set search_path=public as $$
declare a public.checkout_attempts; pay public.payments; begin
 perform 1 from public.invoices where id=p_invoice and company_id=p_company for update;
 if not found then raise exception 'Invoice not found'; end if;
 select * into strict a from public.checkout_attempts where id=p_attempt and invoice_id=p_invoice and company_id=p_company for update;
 if p_amount is null or a.amount_cents<>p_amount or p_fee is null or p_fee<0 or p_fee>round(p_amount::numeric*coalesce(a.surcharge_basis_points,0)/10000) then raise exception 'Checkout fee mismatch'; end if;
 if a.state='paid' and a.fee_cents<>p_fee then raise exception 'Recorded fee mismatch'; end if;
 update public.checkout_attempts set fee_cents=p_fee where id=a.id;
 select * into pay from public.crm_record_payment(p_invoice,p_company,p_amount,p_method,p_external,null,null,p_attempt,p_event,p_event_type,p_fee,p_receipt);
 update public.communication_events set metadata=metadata || jsonb_build_object('fee_cents',p_fee,'total_cents',p_amount+p_fee)
 where dedupe_key='payment:'||pay.id and company_id=p_company;
 return pay;
end $$;
revoke all on function public.crm_reserve_surcharge_checkout(text,text,integer) from public,anon,authenticated;
revoke all on function public.crm_record_surcharge_payment(text,text,bigint,text,text,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.crm_reserve_surcharge_checkout(text,text,integer) to service_role;
grant execute on function public.crm_record_surcharge_payment(text,text,bigint,text,text,uuid,text,text,bigint,text) to service_role;
commit;
