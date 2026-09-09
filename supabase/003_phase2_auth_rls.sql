-- ============================================================
-- Air King CRM — Phase 2: authenticated, per-user security
-- Run in the Supabase SQL editor AFTER 002_schema_only.sql.
-- This LOCKS DOWN the database: anonymous access stops working.
-- From here on, a user must be logged in to read or write data.
-- ============================================================

-- ---------- 1. PROFILES TABLE ----------
-- One row per auth user: maps a user to their company + role.
-- Inserted by an admin/service-role script (not by users),
-- so randos cannot grant themselves access to a company.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id text not null default 'air-king',
  role text not null default 'member',
  full_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- A user may read only their own profile row.
create policy "profile_read_self"
  on profiles for select to authenticated
  using (id = auth.uid());

-- (No insert/update/delete policy for users on profiles.
--  Profiles are created by the admin script using the service
--  role key, which bypasses RLS. A user with no profile row
--  sees no app data — that is the invite-only gate.)

-- ---------- 2. COMPANY HELPER (SECURITY DEFINER) ----------
-- Returns the calling user's company_id, or null if they have
-- no profile yet. Marked SECURITY DEFINER so it bypasses RLS
-- on profiles when called from other policies — no recursion.
create or replace function public.get_my_company_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.profiles
  where id = auth.uid();
$$;

-- ---------- 3. DROP PHASE 1 WIDE-OPEN POLICIES ----------
drop policy if exists phase1_public_read   on customers;
drop policy if exists phase1_public_insert  on customers;
drop policy if exists phase1_public_update  on customers;

drop policy if exists phase1_public_read   on customer_notes;
drop policy if exists phase1_public_insert  on customer_notes;
drop policy if exists phase1_public_update  on customer_notes;

drop policy if exists phase1_public_read   on customer_photos;
drop policy if exists phase1_public_insert  on customer_photos;
drop policy if exists phase1_public_update  on customer_photos;

drop policy if exists phase1_public_read   on work_orders;
drop policy if exists phase1_public_insert  on work_orders;
drop policy if exists phase1_public_update  on work_orders;

drop policy if exists phase1_public_read   on invoices;
drop policy if exists phase1_public_insert  on invoices;
drop policy if exists phase1_public_update  on invoices;

drop policy if exists phase1_public_read   on quotes;
drop policy if exists phase1_public_insert  on quotes;
drop policy if exists phase1_public_update  on quotes;

drop policy if exists phase1_public_read   on memberships;
drop policy if exists phase1_public_insert  on memberships;
drop policy if exists phase1_public_update  on memberships;

-- ---------- 4. AUTHENTICATED COMPANY-SCOPED POLICIES ----------
-- A logged-in user can only touch rows whose company_id matches
-- their own profile's company_id. USING filters reads/deletes;
-- WITH CHECK validates inserts and the new state of updates.
-- (company_id is a real top-level column — never trust the
--  jsonb blob.)

-- ---- customers ----
create policy "auth_read"   on customers for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on customers for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on customers for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on customers for delete to authenticated
  using (company_id = public.get_my_company_id());

-- ---- customer_notes ----
create policy "auth_read"   on customer_notes for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on customer_notes for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on customer_notes for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on customer_notes for delete to authenticated
  using (company_id = public.get_my_company_id());

-- ---- customer_photos ----
create policy "auth_read"   on customer_photos for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on customer_photos for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on customer_photos for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on customer_photos for delete to authenticated
  using (company_id = public.get_my_company_id());

-- ---- work_orders ----
create policy "auth_read"   on work_orders for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on work_orders for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on work_orders for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on work_orders for delete to authenticated
  using (company_id = public.get_my_company_id());

-- ---- invoices ----
create policy "auth_read"   on invoices for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on invoices for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on invoices for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on invoices for delete to authenticated
  using (company_id = public.get_my_company_id());

-- ---- quotes ----
create policy "auth_read"   on quotes for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on quotes for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on quotes for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on quotes for delete to authenticated
  using (company_id = public.get_my_company_id());

-- ---- memberships ----
create policy "auth_read"   on memberships for select to authenticated
  using (company_id = public.get_my_company_id());
create policy "auth_insert" on memberships for insert to authenticated
  with check (company_id = public.get_my_company_id());
create policy "auth_update" on memberships for update to authenticated
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());
create policy "auth_delete" on memberships for delete to authenticated
  using (company_id = public.get_my_company_id());

-- Done. The database is now locked to authenticated users in
-- their own company. Next: create the 3 users (admin script)
-- and add the login screen to the app.
