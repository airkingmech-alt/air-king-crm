grant select, insert, update, delete on table public.price_book_items to authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.invoice_line_items to authenticated;
grant select on table public.lead_sources to authenticated;

create unique index if not exists price_book_company_sku_exact
on public.price_book_items(company_id, sku)
where sku is not null;
create index if not exists invoice_line_items_invoice_fk on public.invoice_line_items(invoice_id);
create index if not exists invoice_line_items_price_book_fk on public.invoice_line_items(price_book_item_id);
create index if not exists leads_customer_fk on public.leads(customer_id);
create index if not exists leads_assigned_fk on public.leads(assigned_to);

alter function public.crm_touch_updated_at() set search_path = public;

create or replace function public.crm_can(p_permission text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and (
        role = 'owner'
        or coalesce((permissions ->> p_permission)::boolean, true)
      )
  );
$$;

revoke all on function public.crm_can(text) from public, anon;
grant execute on function public.crm_can(text) to authenticated;

drop policy if exists company_staff on public.price_book_items;
create policy price_book_staff on public.price_book_items
for all to authenticated
using (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and (select public.crm_can('pricebook'))
)
with check (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and (select public.crm_can('pricebook'))
);

drop policy if exists company_staff on public.leads;
create policy leads_staff on public.leads
for all to authenticated
using (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and (select public.crm_can('leads'))
)
with check (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and (select public.crm_can('leads'))
);

drop policy if exists company_staff on public.invoice_line_items;
create policy invoice_lines_staff on public.invoice_line_items
for all to authenticated
using (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and (select public.crm_can('invoices'))
)
with check (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and (select public.crm_can('invoices'))
);

drop policy if exists company_staff on public.lead_sources;
create policy lead_sources_admin on public.lead_sources
for select to authenticated
using (
  company_id = (select company_id from public.profiles where id = (select auth.uid()))
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin')
  )
);
