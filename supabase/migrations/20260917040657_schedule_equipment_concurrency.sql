-- Reuse the existing timestamp trigger for legacy as well as server-side writes.
-- No rows are rewritten. Concurrency checks use a short timestamp filter rather
-- than embedding potentially large customer JSON in a PostgREST request URL.
create trigger schedule_work_orders_touch before update on public.work_orders
for each row execute function public.crm_touch_updated_at();

create trigger equipment_customers_touch before update on public.customers
for each row execute function public.crm_touch_updated_at();
