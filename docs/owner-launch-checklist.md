# Air King CRM — owner launch checklist

The implementation is on `feature/payments-communications`, draft pull request #1. It is not deployed. Production accounts, passwords, customers and balances are unchanged. Do not merge the pull request or enable customer sending yet.

## First decision: a separate test environment

Only one Supabase project and the production Render app are currently connected. Before testing real provider connections, approve a separate **Air King CRM Staging** app and database. Use synthetic customers only, not a copy of production customer data. Any paid resources or plan upgrades need your approval first. A Stripe sandbox alone does not isolate CRM data: the database must also be separate.

After approval, the implementation work includes preparing the test database, applying the migration there, connecting the feature branch, and checking the existing staff workflows. Do not point a staging app at the production Supabase database.

## What you handle

### 1. Stripe: payment account

- Sign in to [Stripe Dashboard](https://dashboard.stripe.com/) or create Air King's business account.
- Complete any business identity and bank-account setup Stripe requests yourself.
- Create/select a sandbox for testing. Keep live mode off during acceptance tests.
- When the staging app is ready, save its sandbox server key in the staging Render service as `STRIPE_SECRET_KEY`; save the endpoint's separate signing secret as `STRIPE_WEBHOOK_SECRET`.
- Do not send either value in chat or put it in GitHub. We do not need your bank login or a real card for testing.

Stripe's [API-key guide](https://docs.stripe.com/keys) and [test-payment guide](https://docs.stripe.com/testing) explain the separation between sandbox and real payments. The current implementation expects a standard `sk_test_`/`sk_live_` server key; restricted-key mode detection and permissions must be validated before using a restricted key.

### 2. Twilio: business texting

- Sign in to [Twilio Console](https://console.twilio.com/) or create an Air King account.
- Choose an SMS-capable business number and Messaging Service. Confirm any number purchase and usage costs yourself.
- Complete the registration/verification required for your chosen number. For a US local number, follow [Twilio's A2P 10DLC process](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc). Do not assume your existing business phone can send through Twilio without number setup.
- Save `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` directly in the staging Render environment when it is ready.
- Choose a phone you control for test messages and explicitly approve using it. No existing customer numbers will be used.

### 3. Email: sender domain

- Sign in to [Resend](https://resend.com/) or create an account.
- Choose the domain and sender address Air King will use. Example only: `office@your-owned-domain`; do not use a Gmail address as a domain you own.
- Add the exact DNS records Resend supplies and wait for verification. Do not replace unrelated website or existing email records. See [domain verification](https://resend.com/docs/dashboard/domains/introduction).
- Save `RESEND_API_KEY` and the callback signing secret `RESEND_WEBHOOK_SECRET` directly in staging Render.
- Choose an email inbox you control for test deliveries and approve its use.

## What the implementation work handles next

1. Isolated staging database and app preparation after resource/cost approval.
2. Safe migration application, RLS verification and Supabase security advisors.
3. Separate generated worker/unsubscribe secrets, without changing account passwords.
4. Exact staging webhook addresses, secure scheduler installation and execution checks.
5. Controlled Stripe full/partial/second/failed payments, duplicate webhook and receipt tests.
6. Controlled email/SMS delivery, opt-out, quiet-hours and automation stop-condition checks.
7. Staff-screen regression checks, migration backup/recovery readiness, then production release through GitHub → Render.
8. Production logs and safe smoke tests; all starter automations remain disabled until reviewed individually.

The detailed environment names and callback paths are in [integration-setup.md](integration-setup.md). Staging callback URLs must use the staging app's actual URL, not the production URL listed there. Save credentials only on the intended service; do not replace the whole environment-variable list.

## Current limits

Card surcharge charging remains unavailable pending a validated credit-card eligibility/compliance implementation. No live payment, SMS/email delivery, browser-regression, or installed-scheduler tests have been completed. The 51-test automated suite now includes actual database role restrictions and 14-starter installation checks, but these are not substitutes for provider end-to-end tests. Release review also updated two transitive dependencies (`nanoid` and `qs`) to remediate the production-dependency audit findings.

The production security advisor also reports the pre-existing public company-lookup function and disabled leaked-password protection. The proposed migration removes anonymous execution of the helper. Staff execution remains necessary for current company-scoped RLS and needs review, not a blanket revoke. Review [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) separately; no existing passwords were changed.
