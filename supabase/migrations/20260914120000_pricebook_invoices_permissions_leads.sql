set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.profiles add column if not exists permissions jsonb not null default '{}'::jsonb;

create table if not exists public.price_book_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  item_type text not null check (item_type in ('equipment','part','service','labor')),
  category text not null default 'Parts',
  name text not null,
  description text not null default '',
  sku text,
  brand text,
  model text,
  unit text not null default 'each',
  cost_cents integer not null default 0 check (cost_cents >= 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  taxable boolean not null default true,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists price_book_company_sku
  on public.price_book_items(company_id, lower(sku)) where sku is not null;
create index if not exists price_book_company_type
  on public.price_book_items(company_id,item_type,active);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  customer_id text references public.customers(id) on delete set null,
  status text not null default 'new' check (status in ('new','contacted','qualified','appointment','quoted','won','lost','spam')),
  source text not null default 'manual',
  source_ref text,
  name text not null,
  email text,
  phone text,
  address text,
  city text,
  state text,
  postal_code text,
  service_type text,
  message text not null default '',
  assigned_to uuid references public.profiles(id) on delete set null,
  last_contact_at timestamptz,
  converted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_source_dedupe
  on public.leads(company_id,source,source_ref) where source_ref is not null;
create index if not exists leads_company_queue
  on public.leads(company_id,status,created_at desc);

create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  name text not null,
  source_key text not null,
  enabled boolean not null default true,
  secret text not null default encode(gen_random_bytes(24),'hex'),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,source_key)
);

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  invoice_id text not null references public.invoices(id) on delete cascade,
  price_book_item_id uuid references public.price_book_items(id) on delete set null,
  line_type text not null default 'service' check (line_type in ('equipment','part','service','labor','discount','other')),
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price_cents integer not null default 0,
  cost_cents integer not null default 0,
  taxable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists invoice_lines_invoice
  on public.invoice_line_items(company_id,invoice_id,sort_order);

alter table public.price_book_items enable row level security;
alter table public.leads enable row level security;
alter table public.lead_sources enable row level security;
alter table public.invoice_line_items enable row level security;

do $$ declare t text;
begin
  foreach t in array array['price_book_items','leads','lead_sources','invoice_line_items'] loop
    execute format('drop policy if exists company_staff on public.%I',t);
    execute format($p$create policy company_staff on public.%I for all to authenticated
      using (company_id=(select company_id from public.profiles where id=auth.uid()))
      with check (company_id=(select company_id from public.profiles where id=auth.uid()))$p$,t);
  end loop;
end $$;

create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
drop trigger if exists price_book_touch on public.price_book_items;
create trigger price_book_touch before update on public.price_book_items
for each row execute function public.crm_touch_updated_at();
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
for each row execute function public.crm_touch_updated_at();

insert into public.lead_sources(company_id,name,source_key)
values
 ('air-king','Website form','website'),
 ('air-king','Google Business Profile','google_business'),
 ('air-king','Facebook / Instagram','meta'),
 ('air-king','Phone call','phone'),
 ('air-king','Manual entry','manual')
on conflict(company_id,source_key) do nothing;

comment on table public.leads is 'Unified lead inbox. External forms post through the authenticated server intake endpoint; never expose lead source secrets in the browser.';
comment on column public.profiles.permissions is 'Per-user overrides keyed by CRM capability. Owners always retain full access.';
