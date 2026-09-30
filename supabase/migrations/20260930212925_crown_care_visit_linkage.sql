set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Structured links only. Existing description-only jobs and legacy seasonal
-- history are deliberately not inferred or rewritten by this migration.
create function crm_private.sync_crown_visit() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 member public.memberships%rowtype;
 season text; slot text; visit jsonb; next_visit jsonb; next_data jsonb;
 owns_slot boolean; completed_delta integer;
begin
 if tg_op='DELETE' then
  if old.data->>'membershipId' is not null then
   raise exception 'Cancel linked Crown Care jobs instead of deleting their history';
  end if;
  return old;
 end if;
 if tg_op='UPDATE' and (old.data->>'membershipId' is not null or old.data->>'membershipSeason' is not null) then
  if new.data->>'membershipId' is distinct from old.data->>'membershipId'
     or new.data->>'membershipSeason' is distinct from old.data->>'membershipSeason'
     or new.id is distinct from old.id or new.company_id is distinct from old.company_id
     or new.customer_id is distinct from old.customer_id then
   raise exception 'A Crown Care job cannot change its membership, season, or customer';
  end if;
 end if;
 if new.data->>'membershipId' is null and new.data->>'membershipSeason' is null then return new; end if;
 season:=new.data->>'membershipSeason';
 if coalesce(trim(new.data->>'membershipId'),'')='' or season is null or season not in ('spring','fall') then
  raise exception 'Choose a Crown Care membership and spring or fall visit';
 end if;
 if new.data->>'id' is distinct from new.id or new.data->>'customerId' is distinct from new.customer_id then
  raise exception 'Invalid Crown Care job identity';
 end if;
 if coalesce(new.data->>'status','') not in ('Unscheduled','Scheduled','Dispatched','In Progress','Completed','Cancelled','Needs Follow-up') then
  raise exception 'Invalid Crown Care job status';
 end if;
 if new.data->>'status' not in ('Unscheduled','Needs Follow-up','Cancelled') then
  if coalesce(new.data->>'scheduledDate','') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(new.data->>'scheduledTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
   raise exception 'Choose a valid appointment date and time';
  end if;
  -- PostgreSQL rejects impossible dates, rather than normalizing February 30.
  perform (new.data->>'scheduledDate')::date;
 end if;
 select * into member from memberships where id=new.data->>'membershipId'
   and company_id=new.company_id for update;
 if not found or member.data->>'deletedAt' is not null then
  raise exception 'Membership unavailable or Crown Care access restricted';
 end if;
 if member.customer_id is distinct from new.customer_id
    or member.data->>'customerId' is distinct from new.customer_id then
  raise exception 'The membership belongs to a different customer';
 end if;
 if (tg_op='INSERT' or old.data->>'membershipId' is null
     or (old.data->>'status'='Cancelled' and new.data->>'status'<>'Cancelled'))
    and member.data->>'status' is distinct from 'Active' then
  raise exception 'Only active Crown Care memberships can book a new visit';
 end if;
 slot:=season||'Visit';
 visit:=coalesce(nullif(member.data->slot,'null'::jsonb),'{}'::jsonb);
 owns_slot:=coalesce(visit->>'workOrderId'=new.id,false);
 if not owns_slot then
  -- A cancelled old job must never reclaim or clear a replacement booking.
  if tg_op='UPDATE' and old.data->>'status'='Cancelled' and new.data->>'status'='Cancelled' then return new; end if;
  if visit->>'workOrderId' is not null
     or coalesce(visit->>'status','Unscheduled') not in ('Unscheduled','Not Scheduled') then
   raise exception 'This seasonal visit is already scheduled or completed. Open the existing job';
  end if;
 end if;
 completed_delta:=(case when new.data->>'status'='Completed' then 1 else 0 end)
   -(case when owns_slot and visit->>'status'='Completed' then 1 else 0 end);
 next_visit:=visit-'workOrderId'-'scheduledDate'-'scheduledTime'-'technician'-'completedAt';
 if new.data->>'status'='Cancelled' then
  next_visit:=next_visit||jsonb_build_object('status','Unscheduled');
 else
  next_visit:=next_visit||jsonb_build_object('workOrderId',new.id,'status',
   case when new.data->>'status'='Completed' then 'Completed'
        when new.data->>'status' in ('Unscheduled','Needs Follow-up') then 'Unscheduled'
        else 'Scheduled' end);
  if new.data->>'status' not in ('Unscheduled','Needs Follow-up') then
   next_visit:=next_visit||jsonb_strip_nulls(jsonb_build_object('scheduledDate',new.data->>'scheduledDate',
    'scheduledTime',new.data->>'scheduledTime','technician',new.data->>'technician'));
  end if;
  if new.data->>'status'='Completed' then
   next_visit:=next_visit||jsonb_build_object('completedAt',coalesce(visit->>'completedAt',new.data->>'completedAt',now()::text));
  end if;
 end if;
 next_data:=jsonb_set(member.data,array[slot],next_visit);
 if completed_delta<>0 then
  next_data:=next_data||jsonb_build_object('visitsUsed',greatest(0,coalesce((member.data->>'visitsUsed')::integer,0)+completed_delta));
 end if;
 if next_data is distinct from member.data then
  update memberships set data=next_data where id=member.id and company_id=member.company_id;
  if not found then raise exception 'Crown Care visit update not permitted'; end if;
 end if;
 return new;
end $$;
revoke all on function crm_private.sync_crown_visit() from public,anon,authenticated;
create trigger crown_visit_sync before insert or update or delete on public.work_orders
for each row execute function crm_private.sync_crown_visit();

-- Required new entry point returns both confirmed records and fails closed if
-- this migration has not been applied. All writes still run under caller RLS.
create function public.crm_schedule_crown_visit(p_work_order jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved jsonb; membership jsonb; company text;
begin
 if not public.crm_can('schedule') or not public.crm_can('memberships') then
  raise exception 'Schedule and Crown Care access are required';
 end if;
 if coalesce(trim(p_work_order->>'membershipId'),'')=''
    or coalesce(p_work_order->>'membershipSeason','') not in ('spring','fall')
    or p_work_order->>'status' is distinct from 'Scheduled' then
  raise exception 'Choose a membership, seasonal visit, and appointment';
 end if;
 -- Serialize identical retries before crm_save_records checks for an existing ID.
 select company_id into company from profiles where id=auth.uid();
 perform pg_advisory_xact_lock(hashtextextended(company||':crown-job:'||coalesce(p_work_order->>'id',''),0));
 saved:=public.crm_save_records(jsonb_build_array(jsonb_build_object(
  'table','work_orders','id',p_work_order->>'id','data',p_work_order)))->0;
 select data into membership from memberships where id=saved->>'membershipId'
  and company_id=(select company_id from profiles where id=auth.uid());
 if membership is null then raise exception 'Membership unavailable or access restricted'; end if;
 return jsonb_build_object('workOrder',saved,'membership',membership);
end $$;
revoke all on function public.crm_schedule_crown_visit(jsonb) from public,anon;
grant execute on function public.crm_schedule_crown_visit(jsonb) to authenticated;
