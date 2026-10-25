# Text Messages

The sidebar's Text Messages page (`/text-messages`) combines the existing SMS outbox with received SMS/opt-out events, grouped by normalized phone within the signed-in staff member's company. `/replies` remains available as the legacy unread/all reply history, with a link to the new page. Customer timeline links remain unchanged.

The page shows the latest 30 conversations and newest 50 messages per thread, with explicit controls for more conversations and older messages. Keyset pagination uses timestamp plus phone/message key for stable tied timestamps; database queries do not depend on PostgREST's default 1,000-row cap. The UI polls every 15 seconds. Only received/opt-out events appear as inbound bubbles: delivery callbacks update the original outbound message rather than creating duplicate bubbles. Accepted, queued, sent, delivered, failed, cancelled and unknown states are distinguished. Timestamps use the viewer's locale; quiet-hour information retains the configured sending timezone.

Opening a conversation does not change shared read status. “Mark displayed replies read” uses the existing company-scoped endpoint and affects only loaded inbound messages. Read history remains visible. If part of a mark-read request fails, the page refreshes current status and shows the error.

Current customer matches are shown separately from original per-message customer links. Shared phones offer an initially blank **Reply as this customer** selector listing only the current company's matching primary contacts. Names and record IDs distinguish duplicate names. The selected name, record ID and recipient remain visible above the composer. Selection does not assign inbound messages or modify any historical links, consent or read state. No-match and additional-contact-only conversations remain blocked. If a phone has more than 21 matches, only the existing bounded set is listed; use the intended customer's Timeline if it is not listed.

The composer checks the selected customer's transactional consent, opt-out/suppression, provider readiness and exact recipient. The send endpoint independently rechecks that selected record against current company-scoped primary-phone matches, then calls the existing idempotent protected outbox, which reloads the recipient and preferences. Sending uses the configured approved SMS template and existing worker, sender selection, quiet hours and retry rules. No marketing is enabled.

Switching conversations or accounts resets shared-phone selection. Switching customers clears unsent drafts. An in-flight or uncertain submission stays in session storage under the original company, staff and customer; explicitly selecting that customer again restores confirmation with the same request key. It cannot move into another customer's composer. Opening or selecting never marks replies read.

The shared-phone selector requires **no new migration, environment configuration, credentials or grants**. Its branch explicitly includes PR #55's separate test-only clock correction for reliable cross-platform checks; that prerequisite changes no application behavior. Neither PR is merged by this work.

## First texts and consent

**Start a text** searches existing customer records, including customers without any message history. The selected customer record and primary recipient remain visible. It uses the existing customer SMS endpoint and protected outbox, without needing a conversation match or changing historical attribution. Choosing a customer does not send a message or change preferences. Customer creation remains in Customers.

New customers keep service-text consent off by default. When permission is missing, **Review communication preferences** opens the existing controls; staff must record actual permission using **Service and invoice texts** and a consent-source note. Saving refreshes SMS readiness immediately. Opt-outs and phone suppression remain enforced and cannot be cleared by this flow. Existing conversation composers link missing-consent guidance to the customer's Timeline. No migration or configuration change is required for this UI update.

## Quote and invoice texts

The quote and invoice Send controls check the selected document's customer readiness before enabling **Text** or **Email + Text**. The read-only document readiness route derives the customer from the company-scoped document and requires the same document/communications permissions as sending; unrelated history permissions are not added. It shows the primary recipient and specific consent, suppression, phone or provider blockers.

When consent is missing, **Review communication preferences** opens the existing saved-preferences controls inside the Send dialog. An actual permission source is required; saving never sends a message, enables marketing automatically, or removes an opt-out. Once saved, readiness refreshes and the dialog returns to document actions. Customer-history permissions remain required to load the preferences editor. Quote and invoice dialogs scroll within the mobile viewport.

This correction addresses the document-delivery flow separately from starting a free-text conversation. Existing failed deliveries remain historical failures; the UI does not automatically retry them. No database migration or consent backfill is included.

Verification: `node --import tsx --test tests/document-sms-readiness.test.ts` and `node tests/document-text-browser.mjs`. The browser check uses the real dialog/components with synthetic APIs, including missing consent, source requirement, immediate refresh, mobile sizing, suppression/STOP, read failures and quote/invoice sends. It sends no live messages.

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

No manual message reassignment or duplicate-customer merging. Start new customer conversations using **Start a text** on Text Messages or the existing customer Timeline. Attachments are not displayed. Outbound bubbles show the stored CRM message content; provider template decoration is not reconstructed. The initial conversation aggregation considers the company's SMS history in PostgreSQL; returned pages and per-phone history are bounded, but very large installations may eventually warrant a maintained conversation summary table.

## Migration access and rollback review

The migration is one transaction with a 5-second lock timeout and 120-second statement timeout. It creates exactly five functions (`crm_text_phone`, `crm_text_matches`, `crm_text_rows`, `crm_text_conversations`, `crm_text_history`) and two SMS-only expression indexes. Ordinary index creation briefly blocks writes on the two message tables while building; use a short low-traffic release window. Failure rolls the transaction back. No table, row, consent, suppression, message attribution, existing RLS policy, or existing table grant changes.

All five functions run as SECURITY INVOKER, never SECURITY DEFINER. They explicitly revoke execution from PUBLIC, anon and authenticated and grant it only to the existing service_role. This works with both older automatic function grants and Supabase's opt-in defaults. It adds persistent callable functions for the already-authorized server role; it does not grant new end-user/database-table privileges or create a role, credential or session. Existing service-role table SELECT permissions remain required. Company scope is mandatory in every source query and is supplied by the verified staff profile, not request data; all five existing history-feature permissions gate the APIs. Service-role calls already bypass RLS, so these scope predicates and service-only grants are essential.

Relations and helper calls are schema-qualified. Four functions have an empty search path; the row-union function deliberately has no SET clause so PostgreSQL can inline it and push phone filters into both indexed sources. A disposable PostgreSQL test proves that temporary tables cannot shadow any source. EXPLAIN on 5,000 outbound plus 5,000 inbound synthetic messages confirms both phone indexes are used by the per-phone history query. The conversation-list summary still aggregates the company's history; pagination bounds returned data, not that initial aggregation. Matching customers scans only the selected company's contacts and returns at most 21 labels with an accurate total count.

Rollback: revert the application first. The additive database objects may remain unused. For full removal, drop the conversation/history functions, then the row/matches helpers, then both indexes, then the phone helper, using explicit signatures and without CASCADE. The phone helper cannot be removed while its indexes depend on it. Removing functions before the app rollback makes the new page unavailable; it does not affect existing SMS delivery. Rollback does not undo messages legitimately sent or read-state changes made while the feature was in use. No automatic down migration or production rollback has been executed.

Synthetic shared-phone previews: `docs/screenshots/shared-phone-replies-desktop.png` and `shared-phone-replies-mobile.png`.
