# Air King CRM — launch repair checklist

Updated September 18, 2026. This supersedes the old PR #1 rollout checklist. The CRM is already deployed; this release repairs the existing application. Checked items describe the evidence below, not certification of every workflow.

## Implemented in this repair release

- [x] Enforce existing team feature toggles in server requests, direct database access, internal quote/invoice routes, and central data loading. Owners retain access and company isolation remains enforced.
- [x] Add restrictive feature policies to 29 existing tables. Combined history/campaign views require access to the related customer, quote, invoice and schedule data.
- [x] Replace fire-and-forget customer, quote, invoice, job, legacy membership and note saves with confirmed saves and visible errors. Forms await confirmation; repeated clicks during pending saves are suppressed.
- [x] Reject conflicting whole-record edits in the shared save path. Save new invoices and their customer equipment changes in one transaction.
- [x] Convert leads to customers atomically. Retrying returns the linked customer instead of creating another.
- [x] Reject another invoice for an already-linked quote/job in the new save path.
- [x] Remove sample business records as production loading fallbacks. Show empty lists and visible read failures honestly.
- [x] Stop inserting fake phone/email details for new customers. Use the signed-in employee as the note/activity author.
- [x] Calculate monthly receipts from payment dates in America/Chicago, excluding historical opening balances. Derive membership totals and unbooked visits from saved memberships.
- [x] Resolve ordering equipment from the editable catalog, retaining legacy lookup for older quotes and keeping unresolved IDs visible for review.
- [x] Replace Crown Care's sample technician list with saved staff. Initial appointment fields save together with the job.
- [x] Preserve selected add-ons when creating quotes; separate cost and selling price in the customer-profile quote flow.
- [x] Remove unnecessary elevated privileges from the company-lookup helper after checking the profile policy and testing company isolation.

Neither migration rewrites or deletes customer data. No new environment variables are required. These repairs did not send customer messages, charge cards, change passwords, enable automations, or purchase hosting.

## September 18 follow-up repairs

- [x] Price-book edits/archive, lead-status updates, template edits/archive and automation edits now compare the record version. A stale screen cannot silently overwrite newer changes. Turning an automation off remains available even from a stale screen; stale saves cannot turn it back on.
- [x] Invoice Save & Send clears the creation form as soon as saving succeeds. Email failure preserves the invoice and shows an Open invoice button, with separate saved-versus-email status. Invalid line amounts are rejected and line totals are rounded to cents.
- [x] List-view job assignment now uses the same server date/time, staff, overlap and stale-edit checks as the calendar. Priority saves with the appointment. Deliberate overlap overrides remain available in the calendar.
- [x] New base quote calculations use the established cost / 0.80 rule through the same pricing helper as the price book. Existing quotes are not repriced.
- [x] 143 automated tests, TypeScript check and production build pass. No database migration or new credentials needed for this follow-up.

## Verification completed

- [x] TypeScript check and production build.
- [x] Automated payment, quote, add-on, scheduling, Crown Care, inventory, time-clock, messaging and automation regression tests. Provider calls are mocked where appropriate.
- [x] New tests for feature denial, owner override, caller-scoped lookup, stale edits, rollback, duplicate invoice retry, atomic lead conversion, and dashboard date boundaries.
- [x] Safe migrations applied. New RPCs are security-invoker and unavailable anonymously. All public ordinary tables have RLS enabled.
- [x] Production invoice balances match the payment ledger in the post-migration check.
- [x] Scheduler inspection: 120 runs, zero failed runs in the sampled hour. This is not proof of delivery for every message.
- [x] Security advisors rerun. Server-only tables intentionally retain RLS without browser policies.

Render live status, recent logs and side-effect-free public smoke tests must also be checked after deployment; the release handoff records their result.

## Not completed / what is needed

| Priority | Item | Blocker or next step |
|---|---|---|
| Launch gate | Signed-in desktop/phone walkthrough | No authenticated staff browser session available. Test owner, dispatcher and technician permissions, failed saves, simultaneous edits, and lead → quote with add-ons → acceptance → unassigned job → schedule → invoice. Do not share passwords in chat. |
| Card collection gate | Actual Stripe sandbox checkout and receipts | Requires an isolated staging app/database and test configuration. Full, partial, second, failed payment and duplicate callback tests must run through Stripe. Production has no recorded Stripe events; local ledger tests are not live acceptance. |
| Card collection gate | Refund/dispute/reversal reconciliation | Automatic synchronization is not implemented. Establish an owner-reviewed Stripe/CRM reconciliation process with the bookkeeper or implement/test reversals before taking cards. Do not change a paid flag to simulate a refund. |
| Launch gate | Production hosting and automatic deployment | Render uses free compute; a paid plan is an owner decision. Earlier logs show GitHub integration access trouble. Reconnect it and confirm a later push actually triggers a deployment. |
| Launch gate | Backup restore, rollback drill and outage alerts | No isolated restore environment or verified retention setup available. Verify backups and restore into a separate database; test rollback and worker/provider failure alerts. Never restore over production as a test. |
| Before texting | Twilio delivery and STOP | Owner/provider setup and an authorized controlled destination needed. Texting was not enabled by this repair. |
| Before relying on intake | Website/Meta live submission | Actual provider/browser access needed to submit a controlled lead and verify account permissions, subscriptions and token lifetime. Mapping/signature tests passed. |
| Before marketing | Failed delivery, consent and automation review | Review the known provider-failed email. Three earlier failures were preference blocks and must not be bypassed. Most automations remain disabled. Test delivery, bounce and opt-out using controlled destinations before activating sequences. |
| Before equipment campaigns | Historical dates and placeholder contacts | Air King must review the placeholder-contact record and missing service dates. New completion transitions already record last service; historical dates/identities were not guessed. |
| Before quoting | Complete estimating review | Base margin now matches the saved Air King rule (cost / 0.80). The legacy Good/Better/Best multipliers and equipment-tax/allowance treatment still need a full estimating review with actual matched equipment before treating generated packages as final prices. Existing quotes were not recalculated. |
| Before subscriptions | Crown Care billing/agreement lifecycle | Tracking and custom equipment/filter/pricing configuration exist. Recurring collection, signed enrollment/cancellation and failed-payment handling remain incomplete. Use manual billing until separately implemented and tested. |
| Security follow-up | Leaked-password protection | Supabase reports it disabled. Owner must enable the supported account/plan setting. Existing passwords remain unchanged. |
| Workflow follow-up | Other editors and initial appointment validation | Shared blob saves and price-book, lead-status, template and automation edits now reject stale versions. Calendar moves and list assignment have conflict checks. Initial new-job/Crown Care creation still needs equivalent validation and membership-visit linkage. |
| Hands-on acceptance | Equipment AI, inventory, clock and calendar | Actual AI-provider accuracy, employee phones, clock corrections, drag/resize gestures and physical stock workflows still require operational testing. Automated rules/database tests are not a substitute. |

## Audit correction

Public `/api/public` routes already have an in-memory IP rate limiter (120 requests/minute). The original audit's statement that no general limiter was found was too broad. No duplicate limiter was added. Distributed/edge abuse protection is still a separate review if the service scales.

## Release and recovery

Migrations:

- `20260917225457_launch_permissions_and_confirmed_saves.sql`: existing permission helper, restrictive policies, atomic saves and lead conversion.
- `20260917231306_company_lookup_invoker.sql`: existing company helper obeys caller permissions.

Pre-repair application release: `b75b8ff9ff7a3cfe2e0e8b39a24737032348cf55`. For an application regression, redeploy that commit through Render and inspect logs. Additive save functions may remain. Do not remove access policies or restore the database blindly to undo a UI problem. No restore drill is claimed.

Proceed with a controlled owner/staff pilot after the access/save walkthrough. Hold live card collection and automatic subscriptions until their separate gates pass. Optional new features are not required for the pilot.
