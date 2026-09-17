# Schedule, equipment scanning, and manual full payment

## Included
- Month/week/day calendar with navigation, mobile long-press dragging, duration resizing, team filter, job preview, assignment, and optional conflict override.
- Authenticated, company-scoped saves with compare-and-swap protection. Job descriptions, quote links, and add-ons are preserved. Failed moves revert. Schedule history stores before/after values, actor, time, and override.
- Mark Paid in Full records the displayed remaining ledger balance through the existing manual-payment transaction. Staff must confirm money was received and choose Cash/Check/ACH/Other. No card is charged. Existing checkout locks, overpayment rejection, deduplication, receipts, and reminder stop conditions remain in place.
- Equipment nameplate scan from customer equipment or calendar job preview. Explicit review and confirmation before any equipment write; per-field confidence/evidence, new/update choice, property selection, photo provenance, and concurrent-edit protection. Manufacture year is not installation date.
- Marketing refrigerant and inclusive numeric filters. Positive equipment filters must match one active unit, not different units on the same customer.
- Removed the old unauthenticated photo-analysis route's fabricated fallback. Ordinary photo uploads remain available; structured scanning is the reviewed equipment workflow.

## Setup
- Migration `20260917040657_schedule_equipment_concurrency.sql` adds update-timestamp triggers on customers and work_orders using the existing crm_touch_updated_at function. It rewrites no rows and changes no RLS/grants. Existing work_orders.data, customers.data.properties[].systems, customer_photos, and payments are reused.
- Set ANTHROPIC_API_KEY only in Render's secret environment configuration if not already configured. Never send it in chat or commit it. Optional ANTHROPIC_MODEL defaults to claude-sonnet-4-6 and must support vision and structured JSON outputs.
- AI requests can incur provider charges. Missing key/provider failure produces an explicit error, never fabricated readings. Test with a non-sensitive nameplate before relying on extraction accuracy.
- Calendar appointments are displayed as Central business-local date/time. Duration defaults to existing laborHours or 60 minutes. Completed/canceled appointments cannot be dragged.
- Existing draft/save invoice workflow and Stripe webhook payment confirmation are unchanged.

## Not included / pending owner choices
Crown Care recurring enrollment is NOT implemented in this release and no existing membership was changed. Confirm monthly/annual pricing, plan coverage, approved enrollment agreement, agreement version, cancellation effective date, and failed-payment grace period before implementing Stripe subscriptions and signed enrollment. Do not activate automatic renewal on existing memberships without consent. Evaluate Stripe Tax and tax registration obligations before configuring subscription tax; this release does not enable automatic tax.

## Verification
TypeScript check, full automated suite, production build, dependency audit. API tests mock external services and cover unauthenticated/disabled staff, company scope, conflict confirmation, stale saves, and preserved scope/add-ons. Existing database tests exercise ledger full/partial/manual/Stripe payments and duplicate protection. No live card charge or customer message is used in testing. Authenticated browser/mobile drag/resize and real-provider photo accuracy require an owner smoke test; automated tests are not a substitute for that check.

## Owner smoke test
1. Open Schedule and check Month/Week/Day. Move a test job, resize it, refresh, and verify it persists. Confirm a conflicting move warns; cancel it once.
2. Open a test job on a phone, review its scope/add-ons, and use Scan Equipment Nameplate. Review/correct all fields before saving. Check the customer equipment tab afterward.
3. In Marketing, preview (do not send) an audience with Equipment type = AC, Equipment age at least 12, and Equipment refrigerant = R-22.
4. On a test unpaid invoice, select the actual payment method and use Mark Paid in Full only if payment was actually received. Verify the ledger and remaining balance; do not mark a real unpaid invoice paid as a test.

## Supabase advisor follow-up
The post-migration advisor reports the existing [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is disabled. Owner action is recommended. It also flags the existing [SECURITY DEFINER company helper](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), which is used by current RLS policies; do not revoke it blindly. Fifteen [RLS-without-policy informational notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) concern intentionally server-only operational tables. This release changes none of those grants or policies.

References: https://fullcalendar.io/docs/eventDrop ; https://platform.claude.com/docs/en/build-with-claude/structured-outputs ; https://supabase.com/docs/guides/database/functions
