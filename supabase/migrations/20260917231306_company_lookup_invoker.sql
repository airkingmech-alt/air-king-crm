-- profiles already grants authenticated SELECT under profile_read_self (id=auth.uid()).
-- The company helper can therefore obey caller RLS without elevated privileges.
set local lock_timeout = '5s';
alter function public.get_my_company_id() security invoker;
