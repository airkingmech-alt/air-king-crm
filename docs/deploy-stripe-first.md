# Stripe-first rollout — Twilio deferred

Owner direction: prepare for deployment with Stripe; hold Twilio until Air King opens its texting account. This is deployment preparation, not confirmation that production or provider testing is complete.

## Current state

- Implementation: draft pull request #1, `feature/payments-communications`.
- Stripe connector lists **Airkingductcleaningservice**, **test mode**. Confirm this is the intended account before account-specific configuration.
- Connecting Stripe to ChatGPT does not install Stripe credentials on Render. The server still needs its own API key and webhook signing secret.
- No Twilio account, number, purchase, or configuration is required for the Stripe rollout.
- No production database migration or deployment has been performed.

## Release checks

Use Node 20, install with `npm ci --include=dev`, then run:

```sh
npm run release:check
```

This runs TypeScript, the isolated test suite, the production dependency audit, and the production build. It does not call live providers, migrate a database, send messages, or deploy the app. Existing Render commands stay unchanged:

- Build: `npm ci --include=dev && npm run build`
- Start: `NODE_ENV=production node dist/index.cjs`

The server's Supabase client explicitly supplies the existing `ws` transport for Node 20 compatibility. Run the tests on Node 20 as well as the build: a successful bundle alone does not verify runtime client initialization.

## Configuration by stage

| Stage | Required setup |
|---|---|
| CRM foundation | Existing Supabase frontend and server settings; reviewed migration applied first; `APP_BASE_URL` matching the deployment |
| Stripe checkout | `STRIPE_SECRET_KEY` (test key first), `STRIPE_WEBHOOK_SECRET`, successful sandbox tests, then Payments ON |
| CRM receipt email | Resend key, verified sender, webhook, signing secret and scheduler; review queue before turning sending ON |
| SMS later | Three Twilio variables, approved number/Messaging Service, opt-out callbacks, controlled delivery tests |

Never put server secrets in `VITE_*` variables, GitHub, or chat. The exact names and webhook events are in [integration-setup.md](integration-setup.md).

## Behavior without Twilio

- The app and Stripe routes load without Twilio credentials.
- Text and Email + Text buttons remain disabled with a setup explanation.
- The server rejects manual SMS and combined delivery requests before queueing either channel.
- SMS automations can be edited and saved OFF. Enabling an automation containing an SMS step requires Twilio configuration.
- Email-only automations and payment processing do not require Twilio.
- All 14 starters remain disabled by default. Existing already-queued SMS still waits for configuration; review the queue before enabling texting later.

## Deployment order

1. Confirm Stripe account; prepare isolated staging and use synthetic customer records only.
2. Apply and verify the migration in staging. Check RLS and existing staff workflows.
3. Save test credentials on the staging Render service. Configure Stripe's callback at the staging URL plus `/api/webhooks/stripe`.
4. Test full/partial/second/failed payments and duplicate callbacks. Verify balances and receipts. A browser return is never payment confirmation.
5. Prepare production backup/recovery readiness, apply the reviewed migration, and run security advisors.
6. Merge the reviewed PR into `master`; monitor the existing GitHub → Render deployment and smoke-test without charging customers.
7. Configure production Stripe keys/webhook and activate payments only after acceptance checks. Leave outbound sending and SMS automations OFF until their respective provider tests are complete.

Stripe-hosted receipts should also be configured in Stripe. CRM receipt emails cannot actually send until the email provider and scheduler are configured; do not describe automatic email receipts as operational before that. Card surcharge charging remains unavailable in this release.
