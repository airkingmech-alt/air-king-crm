# Text Messages

The sidebar's Text Messages page (`/text-messages`) combines the existing SMS outbox with received SMS/opt-out events, grouped by normalized phone within the signed-in staff member's company. `/replies` remains available as the legacy unread/all reply history, with a link to the new page. Customer timeline links remain unchanged.

The page shows the latest 30 conversations and newest 50 messages per thread, with explicit controls for more conversations and older messages. Keyset pagination uses timestamp plus phone/message key for stable tied timestamps; database queries do not depend on PostgREST's default 1,000-row cap. The UI polls every 15 seconds. Only received/opt-out events appear as inbound bubbles: delivery callbacks update the original outbound message rather than creating duplicate bubbles. Accepted, queued, sent, delivered, failed, cancelled and unknown states are distinguished. Timestamps use the viewer's locale; quiet-hour information retains the configured sending timezone.

Opening a conversation does not change shared read status. “Mark displayed replies read” uses the existing company-scoped endpoint and affects only loaded inbound messages. Read history remains visible. If part of a mark-read request fails, the page refreshes current status and shows the error.

Current customer matches are shown separately from original per-message customer links. Multiple matching customers, no matches, or an additional-contact-only match disable the conversation composer. Neither records nor old messages are reassigned. Once there is exactly one current matching primary contact, the existing composer checks transactional consent, opt-out/suppression, provider readiness and exact recipient. The new send endpoint independently verifies the match, then calls the existing idempotent protected outbox. Sending still uses the configured approved SMS template and existing worker, sender selection, quiet hours and retry rules. Navigation or a lost response retains the same request key. No marketing is enabled.

## Release prerequisites

Apply `supabase/migrations/20261024231359_text_conversations.sql` before deploying this code, only after publication approval. It adds read-only, SECURITY INVOKER projections and indexes; functions are service-role-only, with company scope supplied by server-verified staff profiles. No customer/message data changes, provider/environment changes, new credentials, or worker invocation are involved. Deploying without the migration shows a retryable unavailable error; it does not fall back to unscoped or partial history.

The migration was tested in disposable PGlite, not applied to production. Full production migration/advisor verification remains a release step. To roll back the app, the additive functions/indexes can remain unused.

## Verification

- `npm run release:check`
- `npm run build:deploy` (build, dev-dependency pruning, production audit and startup smoke; reinstall dev dependencies afterward if continuing development)
- `node tests/text-messages-browser.mjs` (local Chromium required; mocked auth and APIs, no provider or production calls)
- `node tests/sentdm-replies-browser.mjs` (legacy inbox, existing compose and integration readiness regressions)
- `tests/text-messages-api.test.ts`: verified staff/company scope, all five history permissions, invalid inputs, matching guards and sanitized errors.
- `tests/text-messages-migration.test.ts`: real SQL union/history, original links, company isolation, ambiguous/deleted/additional matches, 1,105-message pagination, conversation pagination, read preservation and database role restrictions.

Screenshots from synthetic data are in `docs/screenshots/text-messages-desktop.png` and `text-messages-mobile.png`.

## Deliberate limits

No manual message reassignment or duplicate-customer merging. Start new customer conversations through the existing customer Timeline. Attachments are not displayed. Outbound bubbles show the stored CRM message content; provider template decoration is not reconstructed. The initial conversation aggregation considers the company's SMS history in PostgreSQL; returned pages and per-phone history are bounded, but very large installations may eventually warrant a maintained conversation summary table.
