-- ============================================================
-- Air King CRM — Phase 2: create profile rows for the 3 users
-- Run this AFTER creating the users in:
--   Supabase → Authentication → Users → Add user
-- (The auth.users rows must exist first; this matches by email.)
-- Runs as the SQL editor superuser, so it bypasses RLS.
-- ============================================================
insert into profiles (id, company_id, role, full_name)
select u.id, 'air-king', x.role, x.full_name
from auth.users u
join (values
  ('colton@airkingmech.com', 'owner',      'Colton Nichols'),
  ('james@airkingmech.com',  'technician',  'James Nichols'),
  ('sarah@airkingmech.com',  'dispatcher',  'Sarah Nichols')
) as x(email, role, full_name) on u.email = x.email
on conflict (id) do update
  set company_id = 'air-king',
      role        = excluded.role,
      full_name   = excluded.full_name;

-- Confirm the profiles were created (column names qualified to avoid ambiguity):
select u.email, profiles.role, profiles.full_name
from profiles
join auth.users u on u.id = profiles.id
order by profiles.role;
