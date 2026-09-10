begin;
create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;

create table public.crm_settings (
 company_id text primary key, data jsonb not null default '{"company_name":"Air King Mechanical Services LLC","timezone":"America/Chicago","sms_start":8,"sms_end":19,"sending_enabled":false,"payments_enabled":false,"fee_enabled":false,"fee_basis_points":0,"fee_fixed_cents":0,"sender_name":"Air King Mechanical Services","sender_email":"","review_url":""}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.crm_settings(company_id) select distinct company_id from public.profiles on conflict do nothing;

create table public.customer_communication_preferences (
 customer_id text primary key references public.customers(id), company_id text not null,
 email_transactional boolean not null default true, sms_transactional boolean not null default false,
 email_marketing boolean not null default false, sms_marketing boolean not null default false,
 sms_stopped boolean not null default false, email_suppressed boolean not null default false,
 consent_source text, consent_at timestamptz, updated_at timestamptz not null default now()
);
create table public.message_templates (
 id uuid primary key default gen_random_uuid(), company_id text not null, name text not null,
 purpose text, description text not null default '', channel text not null check(channel in ('email','sms')),
 category text not null default 'transactional' check(category in ('transactional','marketing')),
 subject text not null default '', body text not null, active boolean not null default true,
 archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.automations (
 id uuid primary key default gen_random_uuid(), company_id text not null, name text not null,
 description text not null default '', enabled boolean not null default false, trigger text not null,
 conditions jsonb not null default '[]', steps jsonb not null default '[]', stop_conditions jsonb not null default '[]',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.communication_events (
 id uuid primary key default gen_random_uuid(), company_id text not null,
 customer_id text references public.customers(id), quote_id text references public.quotes(id),
 invoice_id text references public.invoices(id), job_id text references public.work_orders(id),
 event_type text not null, channel text, status text, metadata jsonb not null default '{}',
 dedupe_key text unique, actor_id uuid, created_at timestamptz not null default now()
);
create index crm_events_customer on public.communication_events(company_id,customer_id,created_at desc);
create table public.automation_runs (
 id uuid primary key default gen_random_uuid(), company_id text not null,
 automation_id uuid not null references public.automations(id), event_id uuid not null references public.communication_events(id),
 step_index integer not null default 0, status text not null default 'waiting', next_at timestamptz not null default now(),
 lease_until timestamptz, claim_token uuid, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(automation_id,event_id)
);
create index crm_runs_due on public.automation_runs(next_at) where status in ('waiting','processing');
create table public.communications (
 id uuid primary key default gen_random_uuid(), company_id text not null, customer_id text not null references public.customers(id),
 quote_id text references public.quotes(id), invoice_id text references public.invoices(id), job_id text references public.work_orders(id),
 template_id uuid references public.message_templates(id), automation_run_id uuid references public.automation_runs(id),
 channel text not null check(channel in ('email','sms')), category text not null check(category in ('transactional','marketing')),
 template_snapshot jsonb, merge_values jsonb, recipient text not null, subject text not null default '', body text not null, status text not null default 'pending',
 provider_id text, provider_status text, provider_status_at timestamptz, error text, reason text not null, actor_id uuid,
 dedupe_key text not null unique, scheduled_at timestamptz not null default now(), attempts integer not null default 0,
 claim_token uuid, claimed_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index crm_messages_due on public.communications(scheduled_at) where status='pending';
create index crm_messages_customer on public.communications(company_id,customer_id,created_at desc);
create unique index crm_messages_provider on public.communications(provider_id) where provider_id is not null;
create table public.document_links (
 id uuid primary key default gen_random_uuid(), company_id text not null, token_hash text not null unique,
 quote_id text references public.quotes(id), invoice_id text references public.invoices(id),
 expires_at timestamptz not null default now()+interval '180 days', revoked_at timestamptz,
 created_at timestamptz not null default now(), check((quote_id is null) <> (invoice_id is null))
);
create table public.quote_acceptances (
 id uuid primary key default gen_random_uuid(), company_id text not null, quote_id text not null unique references public.quotes(id),
 customer_name text not null, decision text not null check(decision in ('accepted','declined')),
 signature text, selected_option text, message text, snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), company_id text not null, invoice_id text not null references public.invoices(id),
 customer_id text not null references public.customers(id), amount_cents bigint not null check(amount_cents>0),
 fee_cents bigint not null default 0 check(fee_cents>=0), method text not null, source text not null,
 external_id text unique, reference text, receipt_url text, paid_at timestamptz,
 actor_id uuid, created_at timestamptz not null default now()
);
create index crm_payments_invoice on public.payments(invoice_id);
create table public.checkout_attempts (
 id uuid primary key default gen_random_uuid(), company_id text not null, invoice_id text not null references public.invoices(id),
 amount_cents bigint not null check(amount_cents>=50), fee_cents bigint not null default 0,
 state text not null default 'reserved', session_id text unique, session_url text,
 expires_at timestamptz not null default now()+interval '35 minutes', created_at timestamptz not null default now()
);
create index crm_checkout_invoice on public.checkout_attempts(invoice_id);
create table public.stripe_events (
 id text primary key, type text not null, payment_id uuid references public.payments(id), created_at timestamptz not null default now()
);

-- Preserve existing balances without claiming to know historical methods or payment dates.
insert into public.payments(company_id,invoice_id,customer_id,amount_cents,method,source,external_id,reference)
select company_id,id,customer_id,round((data->>'paidAmount')::numeric*100)::bigint,'Historical','opening_balance','opening:'||id,'Opening balance carried forward from existing CRM'
from public.invoices where coalesce((data->>'paidAmount')::numeric,0)>0;

-- New tables are server-written. Staff can only read company-scoped operational records.
do $$ declare t text; begin
 foreach t in array array['crm_settings','customer_communication_preferences','message_templates','automations','communication_events','automation_runs','communications','document_links','quote_acceptances','payments','checkout_attempts','stripe_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t not in ('document_links','checkout_attempts','stripe_events') then
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy company_read on public.%I for select to authenticated using (company_id = public.get_my_company_id())',t);
 end if;
 end loop;
end $$;

-- Service-only RPCs use invoker security and transactions, not public privileged endpoints.
create function public.crm_reserve_checkout(p_invoice text,p_company text,p_amount bigint)
returns public.checkout_attempts language plpgsql security invoker set search_path=public as $$
declare inv public.invoices; existing public.checkout_attempts; due bigint; begin
 select * into strict inv from public.invoices where id=p_invoice and company_id=p_company for update;
 if inv.data->>'status' in ('Void','Draft','Paid') then raise exception 'Invoice is not payable'; end if;
 due := round((inv.data->>'amount')::numeric*100)-coalesce((select sum(amount_cents) from public.payments where invoice_id=p_invoice),0);
 if p_amount<50 or p_amount>due then raise exception 'Payment must be at least $0.50 and within the remaining balance'; end if;
 select * into existing from public.checkout_attempts where invoice_id=p_invoice and state in ('reserved','open') and expires_at>now() order by created_at desc limit 1;
 if found then
 if existing.amount_cents <> p_amount then raise exception 'A payment is already in progress. Finish it or wait for it to expire'; end if;
 return existing;
 end if;
 insert into public.checkout_attempts(company_id,invoice_id,amount_cents) values(p_company,p_invoice,p_amount) returning * into existing;
 return existing;
end $$;

create function public.crm_record_payment(p_invoice text,p_company text,p_amount bigint,p_method text,p_external text,p_actor uuid default null,p_reference text default null,p_attempt uuid default null,p_event text default null,p_event_type text default null,p_fee bigint default 0,p_receipt text default null)
returns public.payments language plpgsql security invoker set search_path=public as $$
declare inv public.invoices; pay public.payments; attempt public.checkout_attempts; total_paid bigint; due bigint; begin
 select * into strict inv from public.invoices where id=p_invoice and company_id=p_company for update;
 select * into pay from public.payments where external_id=p_external;
 if found then
 if pay.invoice_id<>p_invoice or pay.amount_cents<>p_amount then raise exception 'Payment reference conflict'; end if;
 if p_event is not null then insert into public.stripe_events(id,type,payment_id) values(p_event,p_event_type,pay.id) on conflict do nothing; end if;
 return pay;
 end if;
 due := round((inv.data->>'amount')::numeric*100)-coalesce((select sum(amount_cents) from public.payments where invoice_id=p_invoice),0);
 if p_attempt is null then
 if p_method not in ('Cash','Check','ACH','Other') or p_amount>due or p_amount<=0 or inv.data->>'status'='Void' then raise exception 'Invalid manual payment'; end if;
 if exists(select 1 from public.checkout_attempts where invoice_id=p_invoice and state in ('reserved','open') and expires_at>now()) then raise exception 'An online payment is in progress'; end if;
 else
 select * into strict attempt from public.checkout_attempts where id=p_attempt and invoice_id=p_invoice;
 if attempt.amount_cents<>p_amount or attempt.fee_cents<>p_fee or p_event is null then raise exception 'Checkout amount mismatch'; end if;
 update public.checkout_attempts set state='paid' where id=p_attempt;
 end if;
 insert into public.payments(company_id,invoice_id,customer_id,amount_cents,fee_cents,method,source,external_id,reference,receipt_url,paid_at,actor_id)
 values(p_company,p_invoice,inv.customer_id,p_amount,p_fee,p_method,case when p_attempt is null then 'manual' else 'stripe' end,p_external,p_reference,p_receipt,now(),p_actor) returning * into pay;
 select sum(amount_cents) into total_paid from public.payments where invoice_id=p_invoice;
 update public.invoices set data = data || jsonb_build_object('paidAmount',total_paid/100.0,'status',case when total_paid>=round((data->>'amount')::numeric*100) then 'Paid' else 'Partial' end),updated_at=now() where id=p_invoice;
 if p_event is not null then insert into public.stripe_events(id,type,payment_id) values(p_event,p_event_type,pay.id); end if;
 insert into public.communication_events(company_id,customer_id,invoice_id,event_type,dedupe_key,actor_id,metadata)
 values(p_company,inv.customer_id,p_invoice,'payment.received','payment:'||pay.id,p_actor,jsonb_build_object('payment_id',pay.id,'amount_cents',p_amount,'overpayment',p_amount>due));
 return pay;
end $$;

create function public.crm_decide_quote(p_quote text,p_company text,p_name text,p_decision text,p_signature text,p_option text,p_message text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare q public.quotes; opt jsonb; result public.quote_acceptances; wo text; begin
 select * into strict q from public.quotes where id=p_quote and company_id=p_company for update;
 select * into result from public.quote_acceptances where quote_id=p_quote;
 if found then return to_jsonb(result); end if;
 if q.data->>'status' in ('Won','Lost','Expired','Cancelled') then raise exception 'This quote is already closed'; end if;
 if nullif(q.data->>'expiresAt','')::timestamptz < now() then raise exception 'This quote has expired'; end if;
 if length(trim(p_name))<2 or p_decision not in ('accepted','declined') then raise exception 'Name and decision are required'; end if;
 select value into opt from jsonb_array_elements(q.data->'options') where value->>'tier'=p_option;
 if p_decision='accepted' and (opt is null or length(trim(p_signature))<2) then raise exception 'Choose an option and provide your signature'; end if;
 insert into public.quote_acceptances(company_id,quote_id,customer_name,decision,signature,selected_option,message,snapshot)
 values(p_company,p_quote,p_name,p_decision,p_signature,p_option,p_message,q.data) returning * into result;
 update public.quotes set data=data||jsonb_build_object('status',case when p_decision='accepted' then 'Won' else 'Lost' end,'selectedOption',p_option,case when p_decision='accepted' then 'acceptedAt' else 'declinedAt' end,now()),updated_at=now() where id=p_quote;
 if p_decision='accepted' and not exists(select 1 from public.work_orders where company_id=p_company and data->>'quoteId'=p_quote) then
 wo := 'wo-'||gen_random_uuid();
 insert into public.work_orders(id,company_id,customer_id,data) values(wo,p_company,q.customer_id,jsonb_build_object('id',wo,'customerId',q.customer_id,'customerName',q.data->>'customerName','quoteId',p_quote,'type',q.data->>'jobType','property','TBD','description',q.data->>'title','status','Unscheduled','priority','Normal'));
 end if;
 return to_jsonb(result);
end $$;

create function public.crm_claim_message(p_id uuid)
returns setof public.communications language sql security invoker set search_path=public as $$
 update public.communications set status='sending',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()
 where id=p_id and status='pending' and scheduled_at<=now() returning *;
$$;
create function public.crm_claim_runs()
returns setof public.automation_runs language sql security invoker set search_path=public as $$
 update public.automation_runs set status='processing',lease_until=now()+interval '2 minutes',claim_token=gen_random_uuid(),updated_at=now()
 where id in(select id from public.automation_runs where (status='waiting' and next_at<=now()) or (status='processing' and lease_until<now()) order by next_at limit 20 for update skip locked) returning *;
$$;

-- Audit changes at their source, including existing UI writes, without generating sends directly.
create function crm_private.capture_entity() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare typ text; cust text; begin
 cust := case when tg_table_name='customers' then new.id else to_jsonb(new)->>'customer_id' end;
 if tg_op='INSERT' then typ:=case tg_table_name when 'customers' then 'customer.created' when 'quotes' then 'quote.created' when 'invoices' then 'invoice.created' when 'work_orders' then 'appointment.scheduled' else 'equipment.maintenance_due' end;
 elsif old.data->>'status' is distinct from new.data->>'status' then
 typ:=case tg_table_name
 when 'quotes' then case new.data->>'status' when 'Won' then 'quote.accepted' when 'Lost' then 'quote.declined' when 'Quote Sent' then null else null end
 when 'invoices' then case new.data->>'status' when 'Paid' then 'invoice.paid' when 'Sent' then null when 'Overdue' then 'invoice.overdue' else null end
 when 'work_orders' then case new.data->>'status' when 'Completed' then 'job.completed' when 'Dispatched' then 'technician.on_the_way' when 'Scheduled' then 'appointment.scheduled' else null end end;
 end if;
 if typ is not null then insert into public.communication_events(company_id,customer_id,quote_id,invoice_id,job_id,event_type,actor_id)
 values(new.company_id,cust,case when tg_table_name='quotes' then new.id end,case when tg_table_name='invoices' then new.id end,case when tg_table_name='work_orders' then new.id end,typ,auth.uid()); end if;
 if tg_table_name='customers' and tg_op='INSERT' and new.data->>'leadStatus'='New' then
 insert into public.communication_events(company_id,customer_id,event_type,actor_id) values(new.company_id,new.id,'lead.created',auth.uid()); end if;
 if tg_table_name='work_orders' and typ='job.completed' then update public.customers set data=data||jsonb_build_object('lastServiceAt',now()) where id=cust and company_id=new.company_id; end if;
 return new;
end $$;
revoke all on function crm_private.capture_entity() from public,anon,authenticated;
create trigger crm_capture_customers after insert or update on public.customers for each row execute function crm_private.capture_entity();
create trigger crm_capture_quotes after insert or update on public.quotes for each row execute function crm_private.capture_entity();
create trigger crm_capture_invoices after insert or update on public.invoices for each row execute function crm_private.capture_entity();
create trigger crm_capture_jobs after insert or update on public.work_orders for each row execute function crm_private.capture_entity();

create function crm_private.enqueue_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.automation_runs(company_id,automation_id,event_id,next_at)
 select new.company_id,id,new.id,now()+make_interval(secs=>coalesce((steps->0->>'wait_minutes')::int,0)*60)
 from public.automations where enabled and company_id=new.company_id and trigger=new.event_type and jsonb_array_length(steps)>0 on conflict do nothing;
 return new;
end $$;
revoke all on function crm_private.enqueue_event() from public,anon,authenticated;
create trigger crm_enqueue_event after insert on public.communication_events for each row execute function crm_private.enqueue_event();

-- Restrict existing helper to authenticated company lookups.
revoke execute on function public.get_my_company_id() from public,anon;
grant execute on function public.get_my_company_id() to authenticated,service_role;
do $$ declare f record; begin for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'crm_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop; end $$;

create function public.crm_document_lifecycle(p_kind text,p_id text,p_company text,p_action text)
returns void language plpgsql security invoker set search_path=public as $$
declare rowdata jsonb; customer text; table_name text; field text; begin
 if p_kind not in ('quote','invoice') or p_action not in ('viewed','sent') then raise exception 'Invalid lifecycle event'; end if;
 table_name:=p_kind||'s';field:=case p_action when 'viewed' then 'firstViewedAt' else 'sentAt' end;
 execute format('select data,customer_id from public.%I where id=$1 and company_id=$2 for update',table_name) into strict rowdata,customer using p_id,p_company;
 if rowdata ? field then return; end if;
 rowdata:=rowdata||jsonb_build_object(field,now());
 if p_action='sent' and rowdata->>'status' in ('Draft','New') then rowdata:=rowdata||jsonb_build_object('status',case when p_kind='quote' then 'Quote Sent' else 'Sent' end); end if;
 execute format('update public.%I set data=$1,updated_at=now() where id=$2',table_name) using rowdata,p_id;
 insert into public.communication_events(company_id,customer_id,quote_id,invoice_id,event_type,dedupe_key)
 values(p_company,customer,case when p_kind='quote' then p_id end,case when p_kind='invoice' then p_id end,p_kind||'.'||p_action,p_kind||':'||p_id||':'||p_action) on conflict do nothing;
end $$;

create function public.crm_install_starters(p_company text,p_definitions jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare d jsonb; t jsonb; step jsonb; template_map jsonb; steps jsonb; tid uuid; begin
 perform pg_advisory_xact_lock(hashtextextended('crm-starters:'||p_company,0));
 if exists(select 1 from public.automations where company_id=p_company) then return; end if;
 for d in select value from jsonb_array_elements(p_definitions) loop
 template_map:='{}';steps:='[]';
 for t in select value from jsonb_array_elements(d->'templates') loop
 insert into public.message_templates(company_id,name,description,channel,category,subject,body,purpose)
 values(p_company,t->>'name',t->>'description',t->>'channel',t->>'category',t->>'subject',t->>'body',t->>'purpose') returning id into tid;
 template_map:=template_map||jsonb_build_object(t->>'channel',tid);
 end loop;
 for step in select value from jsonb_array_elements(d->'steps') loop steps:=steps||jsonb_build_array(step||jsonb_build_object('template_id',template_map->>(step->>'action'))); end loop;
 insert into public.automations(company_id,name,description,trigger,steps) values(p_company,d->>'name',d->>'description',d->>'trigger',steps);
 end loop;
end $$;

create function crm_private.protect_balance() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare paid bigint; acceptance public.quote_acceptances; begin
 if tg_table_name='invoices' then
 select coalesce(sum(amount_cents),0) into paid from public.payments where invoice_id=new.id;
 if tg_op='UPDATE' and new.data->>'amount' is distinct from old.data->>'amount' and (paid>0 or exists(select 1 from public.checkout_attempts where invoice_id=new.id and state in ('open','reserved') and expires_at>now())) then raise exception 'Invoice total cannot change while payments exist'; end if;
 new.data:=new.data||jsonb_build_object('paidAmount',paid/100.0);
 if paid=0 and new.data->>'status' in ('Paid','Partial') and (new.data->>'amount')::numeric>0 then new.data:=new.data||'{"status":"Sent"}'::jsonb; end if;
 if paid>0 then new.data:=new.data||jsonb_build_object('status',case when paid>=round((new.data->>'amount')::numeric*100) then 'Paid' else 'Partial' end); end if;
 else
 select * into acceptance from public.quote_acceptances where quote_id=new.id;
 if found then new.data:=new.data||jsonb_build_object('status',case acceptance.decision when 'accepted' then 'Won' else 'Lost' end,'selectedOption',acceptance.selected_option); end if;
 end if;
 return new;
end $$;
revoke all on function crm_private.protect_balance() from public,anon,authenticated;
create trigger crm_protect_balance before insert or update on public.invoices for each row execute function crm_private.protect_balance();
create trigger crm_protect_acceptance before update on public.quotes for each row execute function crm_private.protect_balance();
revoke all on function public.crm_document_lifecycle(text,text,text,text),public.crm_install_starters(text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_document_lifecycle(text,text,text,text),public.crm_install_starters(text,jsonb) to service_role;
create table public.provider_webhook_events (
 id text primary key, provider text not null, provider_id text not null, payload jsonb not null,
 processed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.provider_webhook_events enable row level security;
revoke all on public.provider_webhook_events from public,anon,authenticated;
grant all on public.provider_webhook_events to service_role;
create index crm_webhooks_pending on public.provider_webhook_events(created_at) where processed_at is null;
create function public.crm_void_invoice(p_invoice text,p_company text)
returns void language plpgsql security invoker set search_path=public as $$
declare inv public.invoices; begin
 select * into strict inv from public.invoices where id=p_invoice and company_id=p_company for update;
 if exists(select 1 from public.payments where invoice_id=p_invoice) then raise exception 'An invoice with payments cannot be voided. Review the payments first.'; end if;
 if exists(select 1 from public.checkout_attempts where invoice_id=p_invoice and state in ('reserved','open') and expires_at>now()) then raise exception 'An online payment is in progress.'; end if;
 update public.invoices set data=data||'{"status":"Void"}'::jsonb,updated_at=now() where id=p_invoice;
 insert into public.communication_events(company_id,customer_id,invoice_id,event_type) values(p_company,inv.customer_id,p_invoice,'invoice.void');
end $$;
revoke all on function public.crm_void_invoice(text,text) from public,anon,authenticated;
grant execute on function public.crm_void_invoice(text,text) to service_role;
commit;
