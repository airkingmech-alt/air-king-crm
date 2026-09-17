-- Keep safe-edit versions current for legacy and server-side writes.
-- Existing membership records, RLS, and payment state remain unchanged.
create trigger crown_care_memberships_touch before update on public.memberships
for each row execute function public.crm_touch_updated_at();
