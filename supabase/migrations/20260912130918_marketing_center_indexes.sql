-- Cover new foreign keys used by lifecycle deletes and campaign reporting.
create index marketing_campaigns_audience_fk on public.marketing_campaigns(audience_id);
create index marketing_steps_template_fk on public.marketing_campaign_steps(template_id) where template_id is not null;
create index marketing_recipients_campaign_fk on public.marketing_campaign_recipients(campaign_id);
create index marketing_recipients_step_fk on public.marketing_campaign_recipients(step_id) where step_id is not null;
create index marketing_recipients_customer_fk on public.marketing_campaign_recipients(customer_id);
create index marketing_recipients_communication_fk on public.marketing_campaign_recipients(communication_id) where communication_id is not null;
create index communication_consent_customer_fk on public.communication_consent_events(customer_id);
create index marketing_attributions_campaign_fk on public.marketing_attributions(campaign_id);
create index marketing_attributions_communication_fk on public.marketing_attributions(communication_id) where communication_id is not null;
create index marketing_attributions_customer_fk on public.marketing_attributions(customer_id);
create index communication_events_campaign_fk on public.communication_events(campaign_id) where campaign_id is not null;
create index communication_events_campaign_run_fk on public.communication_events(campaign_run_id) where campaign_run_id is not null;
create index communications_campaign_fk on public.communications(campaign_id) where campaign_id is not null;
create index communications_campaign_run_fk on public.communications(campaign_run_id) where campaign_run_id is not null;
