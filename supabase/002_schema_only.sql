-- ============================================================
-- Air King CRM — Supabase schema + security (Phase 1)
-- Run this in the Supabase SQL editor. Short lines only —
-- pastes cleanly. Seed data is inserted separately by script.
--
-- WARNING: RLS policies are PERMISSIVE for the Phase 1 staging/demo
-- phase (synthetic test data only). They MUST be replaced with
-- authenticated, per-user policies in Phase 2 (Supabase Auth)
-- BEFORE any real customer data is entered.
-- ============================================================

-- ---------- TABLES ----------
create table if not exists customers (
  id text primary key,
  company_id text not null default 'air-king',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_notes (
  id text primary key,
  company_id text not null default 'air-king',
  customer_id text not null,
  text text not null,
  author text not null,
  date text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_notes_customer on customer_notes(customer_id);

create table if not exists customer_photos (
  id text primary key,
  company_id text not null default 'air-king',
  customer_id text not null,
  data_url text not null,
  file_name text not null,
  uploaded_at text not null,
  analysis text,
  created_at timestamptz not null default now()
);
create index if not exists idx_photos_customer on customer_photos(customer_id);

create table if not exists work_orders (
  id text primary key,
  company_id text not null default 'air-king',
  customer_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wo_customer on work_orders(customer_id);

create table if not exists invoices (
  id text primary key,
  company_id text not null default 'air-king',
  customer_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_inv_customer on invoices(customer_id);

create table if not exists quotes (
  id text primary key,
  company_id text not null default 'air-king',
  customer_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_quotes_customer on quotes(customer_id);

create table if not exists memberships (
  id text primary key,
  company_id text not null default 'air-king',
  customer_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mem_customer on memberships(customer_id);

-- ---------- ROW LEVEL SECURITY (Phase 1: permissive) ----------
alter table customers enable row level security;
alter table customer_notes enable row level security;
alter table customer_photos enable row level security;
alter table work_orders enable row level security;
alter table invoices enable row level security;
alter table quotes enable row level security;
alter table memberships enable row level security;

create policy phase1_public_read   on customers      for select using (true);
create policy phase1_public_insert  on customers      for insert with check (true);
create policy phase1_public_update  on customers      for update using (true) with check (true);

create policy phase1_public_read   on customer_notes for select using (true);
create policy phase1_public_insert  on customer_notes for insert with check (true);
create policy phase1_public_update  on customer_notes for update using (true) with check (true);

create policy phase1_public_read   on customer_photos for select using (true);
create policy phase1_public_insert  on customer_photos for insert with check (true);
create policy phase1_public_update  on customer_photos for update using (true) with check (true);

create policy phase1_public_read   on work_orders    for select using (true);
create policy phase1_public_insert  on work_orders    for insert with check (true);
create policy phase1_public_update  on work_orders    for update using (true) with check (true);

create policy phase1_public_read   on invoices       for select using (true);
create policy phase1_public_insert  on invoices       for insert with check (true);
create policy phase1_public_update  on invoices       for update using (true) with check (true);

create policy phase1_public_read   on quotes         for select using (true);
create policy phase1_public_insert  on quotes         for insert with check (true);
create policy phase1_public_update  on quotes         for update using (true) with check (true);

create policy phase1_public_read   on memberships     for select using (true);
create policy phase1_public_insert  on memberships     for insert with check (true);
create policy phase1_public_update  on memberships    for update using (true) with check (true);

-- Done. Tables + security are ready. Seed data loads next (via API script).
