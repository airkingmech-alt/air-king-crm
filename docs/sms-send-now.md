# One-time transactional Send now

Owner/admin path: Text Messages → select the phone conversation → the existing queued text → **Send now…** → review recipient, original message and quote → **Confirm one-time Send now**. It is never a new composer submission. The preview and POST endpoints are `/api/crm/text-messages/:id/send-now`; both require owner/admin and existing conversation permissions. POST requires the exact recipient and `confirmed: true`.

The action applies only to an existing pending, unattempted transactional SMS with no provider ID or marketing campaign. It records an actor, original schedule and a five-minute expiry in the same transaction that brings this single message due. The existing dispatch path runs immediately and competes with the normal worker through the existing atomic claim. Repeated requests cannot renew the authorization or create another message. A rate-limited retry follows normal quiet hours. Failed/unknown/provider-submitted messages cannot get a fresh override. Expired grants do not send outside hours.

Consent, STOP/phone suppression, primary recipient, global sending state and provider readiness remain enforced. Consent is checked again after claim. No marketing or company-wide quiet-hours change. A stale worker snapshot cannot overwrite a new request's schedule. An uncertain HTTP result must be checked against the same message; do not create a duplicate.

Migration `20261025004206_sms_send_now.sql` adds three nullable fields and one service-role-only SECURITY INVOKER function with an empty search_path and qualified table references. No existing row values, RLS policies or table grants are changed. Only the existing service_role receives EXECUTE; browser roles cannot call it. Applying this migration does not activate any override. PR51's text-conversation migration is already applied and must not be applied again.

Rollback: revert app code first; additive fields/function can remain unused. Do not remove audit events or reset message states. A grant that was already activated is a real send request and cannot be undone by application rollback.

Synthetic tests cover tenant/admin/input guards, atomic request/audit rollback, scheduled-worker races, repeated clicks, stale snapshots, consent revoked after claim, expired authorization, rate limits and unknown outcomes. No real SMS is sent by testing or deployment.
