begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.communications add column send_now_requested_at timestamptz,
 add column send_now_expires_at timestamptz, add column send_now_actor_id uuid;
create function public.crm_request_sms_send_now(p_company text,p_id uuid,p_actor uuid,p_recipient text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.communications; previous_schedule timestamptz;
begin
 if not exists(select 1 from public.profiles where id=p_actor and company_id=p_company and role in ('owner','admin')) then
  raise exception 'Administrator access required.'; end if;
 select * into m from public.communications where id=p_id and company_id=p_company for update;
 if not found then raise exception 'Message unavailable.'; end if;
 if m.channel<>'sms' or m.category<>'transactional' or m.campaign_id is not null or m.recipient<>p_recipient then
  raise exception 'Only this confirmed transactional SMS is eligible.'; end if;
 -- Repeated requests never refresh the grant, copy a message, or resurrect an outcome.
 if m.send_now_requested_at is not null then return jsonb_build_object('already_requested',true,'message',to_jsonb(m)); end if;
 if m.status<>'pending' or m.attempts<>0 or m.provider_id is not null then
  raise exception 'Only an unattempted queued message is eligible.'; end if;
 previous_schedule:=m.scheduled_at;
 update public.communications set send_now_requested_at=now(),send_now_expires_at=now()+interval '5 minutes',
  send_now_actor_id=p_actor,scheduled_at=now(),updated_at=now() where id=p_id returning * into m;
 insert into public.communication_events(company_id,customer_id,quote_id,invoice_id,channel,status,event_type,actor_id,dedupe_key,metadata)
 values(p_company,m.customer_id,m.quote_id,m.invoice_id,'sms','pending','sms.send_now_requested',p_actor,'sms-send-now:'||m.id,
  jsonb_build_object('message_id',m.id,'recipient',m.recipient,'previous_scheduled_at',previous_schedule,'expires_at',m.send_now_expires_at,'confirmation','One transactional message outside company quiet hours'));
 return jsonb_build_object('already_requested',false,'message',to_jsonb(m));
end $$;
revoke all on function public.crm_request_sms_send_now(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_request_sms_send_now(text,uuid,uuid,text) to service_role;
commit;
