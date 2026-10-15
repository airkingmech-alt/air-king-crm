# Sent.dm SMS launch review

Prepared October 15, 2026 against `master` / audited baseline `d1148dad51f925d674aee47d723c3715d3a510a6`. This is review preparation only. No production schema, settings, credentials, messages, or automations were changed. The prior audit recorded zero SMS outbox/callback rows; local synthetic tests do not establish live delivery. Runtime number, template, API key and webhook settings remain unverified and are owned by Air King.

## Connection and required names

Air King's campaign is customer care only. Existing guards continue to pin `channel: ["sms"]`, prohibit marketing, require consent, enforce quiet hours, claim sends atomically and preserve idempotency. WhatsApp is not connected. Do not bypass onboarding using WhatsApp or unrestricted free text.

Store runtime secrets only in the hosting environment; never in Git or PRs:

| Name | Purpose / launch state |
|---|---|
| `SMS_PROVIDER` | Select `sentdm` after approved rollout. |
| `SENT_DM_API_KEY` | Server-only API key for the correct Sent account. |
| `SENT_DM_ACCOUNT_ID` | Exact account or Sender Profile whose events are accepted. |
| `SENT_DM_COMPANY_ID` | Exact CRM company scoped to that account. |
| `SENT_DM_WEBHOOK_SECRET` | Endpoint's `whsec_` signing secret. |
| `SENT_DM_WEBHOOK_ID` | Pin the endpoint ID in production; this is not an event ID. |
| `SENT_DM_TEMPLATE_ID` | Approved customer-care SMS template with the named `message` parameter. |
| `SENT_DM_SENDING_ENABLED` | Keep `false` until separately approved. |
| `CRM_WORKER_SECRET` | Existing protected worker authentication; never expose in a browser. |

Existing platform prerequisites remain `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the configured application URL. The CRM's global sending switch remains an additional gate. There is no new sender-number environment variable: owner must verify the account's actual assigned active SMS sender in Sent.

## Verified provider contract

Verified against the official [event reference](https://docs.sent.dm/start/webhooks/event-types), [signature specification](https://docs.sent.dm/start/webhooks/signature-verification), [first-message guide](https://docs.sent.dm/start/quickstart/first-message) and [error catalog](https://docs.sent.dm/reference/api/error-catalog) on October 15, 2026:

- API v3 uses `x-api-key`, recipient/channel arrays and a template reference. The existing request sends the CRM body as the named `message` template parameter, with one stable CRM-message idempotency key. Acceptance is not delivery.
- Signature input is endpoint ID + signing timestamp + exact raw bytes, dot separated, using the base64-decoded secret after removing `whsec_`. Timing-safe comparison and the five-minute tolerance are preserved.
- `x-webhook-id` identifies the endpoint; `x-webhook-event-id` identifies an event across attempts. The signing timestamp changes on retry. The database key uses the stable event ID **plus SHA-256 of the signed body**, never the signing timestamp. The body hash binds the unsigned event-ID header to authenticated content and prevents a colliding header from dropping a different valid opt-out. For older requests missing that header, the signed body hash supplies the fallback identity. Changed body bytes are distinct receipts; inbound message IDs additionally deduplicate reply history.
- `message.received` uses `inbound_number` for the customer, `outbound_number` for the business, and nullable `text`. SMS and MMS replies are retained; media is not downloaded or rendered.
- `contact.opt_out` uses `from` for the customer, `to` for the business (possibly null), `opt_out: true`, and can have null/absent `message_id` and text for a provider signal. SMS and MMS opt-outs are accepted. `contact.opt_in` and START never restore CRM consent or remove phone suppression, including when events arrive out of order.
- Status events include terminal `message.cancelled`. Failure/blocked/filtered events publish `reason_code` and `reason`; only a validated code and locally authored explanation are retained. Arbitrary provider reason text is discarded.

Subscribe `/api/webhooks/sentdm` to **message and contact events**, including `message.received`, `message.cancelled` and `contact.opt_out`. A message-only subscription misses network-reported opt-outs. Owner must independently verify the endpoint/account/secret and subscription settings.

## Durable processing and reply review

Apply `supabase/migrations/20261015034423_sentdm_launch_safety.sql` **before** deploying this branch. It is additive and is **not applied to any shared or production database** by this task. It adds a service-only company/phone suppression table, shared inbox read columns/indexes, retry eligibility on the existing durable callback table, and two service-only security-invoker RPCs. Existing company/feature RLS on communication history remains in force. No customer records are migrated or rewritten.

Webhook intake commits the callback and any phone suppression in one transaction, then acknowledges with 204. Storage failure yields 503 so delivery can retry. Customer lookup, preference updates and status projection run asynchronously in the existing protected worker (`POST /api/internal/communications/tick`). Confirm the already-approved worker is actually running; do not enable it or new automations merely to test this PR. It also performs other existing CRM work, so it must not be invoked casually against production. An inactive worker delays history/inbox projections, but committed phone suppression still blocks sends.

Customer matching uses company-scoped ordered keyset pages of 500, avoiding the default result cap. One match receives customer history. Duplicate numbers suppress every matching customer's SMS preference, while private reply text stays only in the shared company inbox with an ambiguity warning. Unmatched replies/opt-outs also stay there. Phone-level suppression covers later imports or changed customer associations; toggling a customer preference cannot silently undo it. Re-enabling a suppressed phone requires a separate explicit owner-reviewed consent procedure; this PR provides none.

The **Text replies** navigation entry shows a shared unread badge (100+ when the bounded inbox is full). It leads to reply bodies, unmatched/ambiguous warnings, and customer-history links for unambiguous matches. All reply history remains available through the inbox history toggle with bounded 100-row pages, including reviewed unmatched/ambiguous items. Mark as read records the verified staff actor and server timestamp and does not alter consent. Read/list endpoints require the same communications/customer/quote/invoice/schedule permissions as full customer history and always filter to the verified company. Customer history now displays the reply text. No external notifications are sent.

Outbound callback application locks the callback/message, records history and completes the receipt in one database transaction. Repeated processing is harmless. Callbacks preceding acceptance remain pending and retry after one minute once the provider ID is saved; they do not cause a resend. Older status timestamps do not overwrite newer ones. A terminal projection does not regress to queued/sent/scheduled; delivered may advance to read, including equal timestamps. Conflicting terminal outcomes preserve the first projected terminal state and retain subsequent events in history for manual review. Ambiguous sends whose provider ID was never saved still require provider-history reconciliation; no live API reconciliation or automatic resend is introduced.

## Owner launch gates — all still open

- [ ] Review and approve the PR and additive migration; arrange an isolated staging rollout separately.
- [ ] Finish Sent SMS onboarding; verify US brand/campaign approval, actual assigned active sender, account/API key and customer-care-only registration.
- [ ] Obtain approval for the customer-care template containing the named `message` parameter. Confirm the final rendered text, including the existing STOP footer and provider template wrapper.
- [ ] Verify all names above in the appropriate environment and message **plus contact** subscriptions with the matching endpoint ID/secret. Do not paste secret values into chat.
- [ ] Verify callback worker processing and staff access in isolated staging, without enabling unrelated automations or marketing.
- [ ] Complete the separately approved controlled test below and retain evidence. Do not treat current local tests or API acceptance as live delivery.
- [ ] Review results, queue contents, consent and rollback controls before any separate decision about general texting.

## Exact proposed controlled test — requires later approval

1. Approve the target isolated staging app/database, migration and deployment, a specific internal recipient/phone with recorded SMS consent, exact customer-care template/text, and a strict maximum of **one CRM-originated SMS**. Provider automatic keyword replies may add messages; owner must review them first. Use synthetic customer records only. Leave all automations and marketing disabled. Inspect the queue to ensure no unrelated pending sends can run.
2. Keep both sending gates off initially. Use synthetic signed fixtures against staging to verify invalid/stale/foreign events are rejected; retry duplicates create one receipt; provider opt-out without a message ID suppresses immediately; unmatched and shared-phone events appear safely; foreign/feature-denied staff cannot read or mark another company's reply. Do not forge events against production or real customers.
3. Only after explicit send approval, permit the single manual customer-care SMS during the configured local quiet-hour window. Capture CRM outbox ID, provider ID, acceptance and the delivered callback. If acceptance is unknown, stop and reconcile; never click resend. Repeated HTTP submission of the same already-approved idempotency key must not produce a second send.
4. Have the approved recipient send a short reply and confirm unread indication, body and customer-history navigation. Mark it read; verify another authorized staff session sees shared read state and a denied/foreign session cannot change it.
5. Have that recipient send STOP. Verify the contact event and inbound event deduplicate history where they share a message ID, the company/phone suppression and customer preference, and a queued **synthetic transport-stub** attempt being blocked without any second provider request. Do not send a real second test SMS to prove suppression.
6. Have the recipient send START only if separately included in the approved keyword test. Verify CRM suppression and consent remain unchanged. Exercise cancellation, failures, early/late/duplicate callbacks and an interrupted response solely with synthetic fixtures/stubs; do not create live scheduled sends or force provider failures.
7. Turn test sending gates back off, retain the event/outbox/UI evidence, review unexpected callbacks or provider automatic replies, and obtain separate approval for any production rollout/general texting. Keep durable records and suppression; do not delete them as a rollback shortcut.

## Preparation evidence

On Node **20.20.2**: `npm run check` passed; `npm test` passed **633/633**; `npm run build` passed. `npm audit --omit=dev` found **zero vulnerabilities**. `git diff --check` passed; this repository has no lint script/configured lint command. `node tests/sentdm-replies-browser.mjs` passed local Chromium checks for desktop/mobile unread navigation, safe text rendering, history navigation, duplicate/unmatched warnings, failed/successful shared read state and reviewed history. The test harness mocks authentication and every app API; it does not establish live provider readiness or replace the later staff staging walkthrough. The SQL tests use disposable in-memory PostgreSQL, including intake rollback, duplicate processing, early callbacks, stale/terminal projection, and service-only permissions. Production was not queried or changed by these checks.
