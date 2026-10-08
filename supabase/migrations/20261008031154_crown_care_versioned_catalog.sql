begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Catalog publication is prospective. No stored memberships, inquiries, billing
-- records, or settings are rewritten. The membership guard only protects future writes.
create table public.crown_care_catalogs (
  company_id text primary key,
  version text not null check (length(version) between 1 and 100),
  catalog jsonb not null check (
    jsonb_typeof(catalog) = 'object' and catalog ? 'version'
    and catalog ->> 'version' = version and jsonb_typeof(catalog -> 'tiers') = 'object'
  ),
  history jsonb not null check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crown_care_catalogs enable row level security;
revoke all on public.crown_care_catalogs from public, anon, authenticated, service_role;
grant select, insert, update on public.crown_care_catalogs to service_role;
comment on table public.crown_care_catalogs is
  'Server-only owner-published Crown Care catalog. Existing membership snapshots are never repriced. No row means the immutable first published catalog.';

-- Protect the saved audit trail from accidental replacement by a later server write.
create schema if not exists crm_private;
create function crm_private.guard_crown_catalog_history()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.history -> -1 -> 'after' is distinct from new.catalog then
    raise exception 'The catalog edit must include its complete resulting snapshot';
  end if;
  if tg_op = 'INSERT' then
    if jsonb_array_length(new.history) <> 1 then
      raise exception 'The first catalog publication must contain one edit';
    end if;
  else
    if new.company_id is distinct from old.company_id or new.created_at is distinct from old.created_at then
      raise exception 'Catalog ownership and creation time cannot change';
    end if;
    if new.version = old.version or jsonb_array_length(new.history) <> jsonb_array_length(old.history) + 1
      or new.history - (jsonb_array_length(new.history) - 1) is distinct from old.history
      or new.history -> -1 -> 'before' is distinct from old.catalog then
      raise exception 'Catalog publication must append a new version and preserve edit history';
    end if;
    if exists (select 1 from jsonb_array_elements(old.history) edit
      where edit ->> 'requestKey' = new.history -> -1 ->> 'requestKey') then
      raise exception 'The catalog request key was already published';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function crm_private.guard_crown_catalog_history() from public, anon, authenticated;
grant execute on function crm_private.guard_crown_catalog_history() to service_role;
create trigger crown_catalog_history before insert or update on public.crown_care_catalogs
  for each row execute function crm_private.guard_crown_catalog_history();

-- Membership JSON is also writable through older client/RPC paths. Enforce
-- immutable agreed tier terms at the table boundary, not only the new HTTP route.
create function crm_private.guard_crown_membership_terms()
returns trigger language plpgsql security invoker set search_path = public as $$
declare field_name text; was_tier boolean := false; prior public.memberships%rowtype;
begin
  if tg_op = 'DELETE' then
    if coalesce(old.data -> 'tierPlan', 'null'::jsonb) <> 'null'::jsonb then
      raise exception 'Accepted tier agreements cannot be permanently deleted; preserve the saved membership record';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    prior := old;
  else
    -- BEFORE INSERT also runs for ON CONFLICT updates. Permit harmless legacy
    -- upserts only when the existing same-company agreement is preserved.
    select * into prior from public.memberships
      where id = new.id and company_id = new.company_id and customer_id = new.customer_id;
  end if;
  was_tier := coalesce(prior.data -> 'tierPlan', 'null'::jsonb) <> 'null'::jsonb;
  if current_user in ('authenticated', 'anon') and not was_tier then
    foreach field_name in array array['tierPlan','enrollmentTier','agreement'] loop
      if coalesce(new.data -> field_name, 'null'::jsonb) <> 'null'::jsonb then
        if prior.id is null then
          raise exception 'Use the authenticated staff enrollment workflow to record a Crown Care agreement';
        elsif new.data -> field_name is distinct from prior.data -> field_name then
          raise exception 'Use the authenticated staff enrollment workflow to record a Crown Care agreement';
        end if;
      end if;
    end loop;
  end if;
  if was_tier then
    if new.id is distinct from prior.id or new.company_id is distinct from prior.company_id
      or new.customer_id is distinct from prior.customer_id
      or new.data -> 'id' is distinct from prior.data -> 'id'
      or new.data -> 'customerId' is distinct from prior.data -> 'customerId' then
      raise exception 'Existing tier membership ownership cannot change';
    end if;
    foreach field_name in array array['tierPlan','agreement','pricing','billingFrequency','visitsIncluded','enrollmentTier','startDate','renewalDate','autoRenew'] loop
      if new.data -> field_name is distinct from prior.data -> field_name then
        raise exception 'Existing tier agreement terms are locked; use a reviewed renewal or plan change';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function crm_private.guard_crown_membership_terms() from public, anon;
grant execute on function crm_private.guard_crown_membership_terms() to authenticated, service_role;
create trigger crown_membership_terms before insert or update or delete on public.memberships
  for each row execute function crm_private.guard_crown_membership_terms();

commit;
