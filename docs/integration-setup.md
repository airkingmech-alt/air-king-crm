# Payments and communications: rollout checklist

## Safety defaults

Payments, outbound sending, fees, and all starter automations start OFF. Do not enable sending until existing queued messages and customer consent have been reviewed. No provider-live payment or messaging tests have been performed yet.

SECURITY NOTE: the pre-existing public `scripts/create-users.ts` contained hard-coded initial passwords for three staff accounts. The branch removes these values, but earlier Git history may still contain them. The owner confirmed those accounts are no longer active; this confirmation has not been independently verified. Existing account passwords were left unchanged as requested. Do not reuse the exposed passwords; if any affected account is reactivated, reset its password and revoke old sessions first. No exposed passwords were used or tested during this work.

## Server environment variables

Keep the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and other application settings. Never replace the complete Render environment-variable list.

Add these in the existing Render service's Environment screen:

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | `https://air-king-crm.onrender.com` |
| `STRIPE_SECRET_KEY` | Stripe test secret first; switch to live only after acceptance testing |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this environment's Stripe endpoint |
| `TWILIO_ACCOUNT_SID` | Air King's Twilio account |
| `TWILIO_AUTH_TOKEN` | Twilio server credential and callback verification |
| `TWILIO_MESSAGING_SERVICE_SID` | Approved messaging service / business number |
| `RESEND_API_KEY` | Transactional email provider credential |
| `RESEND_WEBHOOK_SECRET` | Email callback signature verification |
| `COMMUNICATION_SIGNING_SECRET` | Random 32-byte or longer secret for unsubscribe capabilities; keep stable |
| `CRM_WORKER_SECRET` | Separate random 32-byte or longer secret for scheduled worker calls |

Do not paste credentials into chat or put them in frontend variables. The Integrations screen shows presence/status, not credentials. “Connected” currently means configured, not an independently verified provider account.

## Stripe

Configure `https://air-king-crm.onrender.com/api/webhooks/stripe` for:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Use the same mode for the secret key and webhook. Enable Stripe customer receipts as an additional provider receipt; the CRM also queues its own audited email receipt. Stripe Checkout collects the email needed for Stripe receipts. Card and manual payments share one ledger. A checkout reservation blocks a conflicting manual payment while online payment is in progress.

Card-fee settings are stored centrally but charging a surcharge is intentionally unavailable in this release. Credit/debit eligibility and applicable surcharge rules need a separate validated implementation. Do not enable a blanket fee for all cards.

## Twilio

Choose the business number and complete applicable business messaging registration. Enable Advanced Opt-Out on the Messaging Service. Configure inbound messages to `https://air-king-crm.onrender.com/api/webhooks/twilio/inbound`. Outgoing messages supply `https://air-king-crm.onrender.com/api/webhooks/twilio/status` automatically. Record consent before sending texts. STOP blocks all texts; marketing email preferences remain separate. Incoming messages are logged, but there is no full two-way conversation composer yet.

## Email

Verify Air King's sending domain with Resend using the DNS records supplied by the provider. Enter the verified sender address and display name in Integrations. Configure `https://air-king-crm.onrender.com/api/webhooks/email` and subscribe to delivery, bounce, complaint, and failure events. Save its signing secret on Render.

## Scheduler — required before automations are operational

The free Render web service is NOT itself a reliable scheduler. Invoke `POST /api/internal/communications/tick` once per minute with `Authorization: Bearer <CRM_WORKER_SECRET>` using Supabase Cron + pg_net and a Vault-held secret, or a separately approved Render cron job. Do not put secrets directly in cron command text. No recurring job is installed by the application migration.

The worker processes persistent runs, messages, callbacks and date triggers. It claims work atomically, rechecks state/consent, and preserves messages outside allowed SMS hours. Ambiguous provider outcomes are marked Unknown for review, not automatically resent. Definitive rate limits have bounded retries. Turning off an automation stops its queued follow-up messages; old stopped runs do not automatically resume when re-enabled.

## Dates and starter workflows

Use Automations → Add Starter Automations once. The 14 starters are editable and all are disabled initially. Existing past events are not retroactively enrolled. Dates currently use the existing scheduledDate/scheduledTime (or scheduledAt), lastServiceAt, and equipment maintenanceDueAt/replacementFollowUpAt data fields. Appointment reminders emit at 24 and 2 hours before a scheduled job. Custom equipment date editing, configurable inactivity thresholds, and a campaign audience builder still need dedicated UI work.

## Testing and release gates

Automated isolated-database/domain/provider-stub checks cover partial and full payments, duplicate callbacks, rollback on mismatch, manual + Stripe settlement, stale balance updates, quote acceptance/decline/expiry, work-order creation, queue claims, delays, stop conditions, opt-outs, failure handling, unsubscribe signatures, and quiet hours including daylight savings. Run `npm run check`, `npm test`, and `npm run build` on Node 20.

Still required: actual Stripe sandbox sessions (full, partial, second payment, failure, and receipt), Twilio delivery/STOP callbacks using a controlled test number, verified-domain email delivery/bounce callbacks, scheduler execution, and authenticated browser regression checks of existing staff workflows. The local browser preview was blocked by the environment. Do not represent these tests as complete.

## Rollback and follow-up work

Disable outbound sending and payments first if an issue occurs. Revert the application commit through GitHub/Render if necessary. Keep the additive tables and ledger; do not roll back by deleting payment or customer data. Existing JSON balances and status values are preserved, with canonical ledger protection after migration.

Next work: eligible card surcharges, refunds/disputes and overpayment reconciliation UI, provider reconciliation for Unknown messages, template delivery-provider adapters, campaign segmentation, equipment-date editing, configurable reminder thresholds, and broader end-to-end/role-isolation tests. Overpayments are retained and flagged in timeline metadata, not automatically refunded.
