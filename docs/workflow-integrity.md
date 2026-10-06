# Accepted quote and scheduling integrity

## Accepted quote → draft invoice

New staff approvals and signed customer approvals capture a versioned `acceptedScope` in the same database transaction as acceptance. It contains the selected package, saved equipment description/identifiers, installation scope, selected add-on names/prices, itemized invoice lines and exact total. New drafts also save their displayed add-on catalog. The fallback catalog applies only when accepting an older, still-open draft; a parity test protects its correspondence to displayed prices.

An accepted quote's commercial fields and snapshot are immutable through every write path. Proposal options and add-ons are locked. Creating an invoice posts only the quote identity; the server/transaction constructs a Draft invoice from the accepted snapshot, never from browser totals or today's pricebook. Quote-linked invoices retain immutable financial scope while payments, delivery, voiding and soft deletion keep their existing workflows. A database uniqueness constraint protects active quote invoices even under concurrent writes. Historical job-only invoices are discovered across all related jobs and returned unchanged. Quote/job links are durable and cannot be removed, reassigned or attached to already-billed generic work to bypass validation. A private invoice validation trigger can check this link even when the invoice editor lacks scheduling access, without exposing job data.

`Create draft revision` explicitly creates a separate, reviewable Draft with a link to its original quote. Staff can select a different saved option/add-on combination and must obtain fresh approval before billing. For materially different equipment, installation scope or package pricing, prepare a newly priced draft through the quote builder. Existing acceptance, job and invoice are never silently replaced or cancelled; review/reconcile them before approving replacement work. No revision is automatically sent.

Legacy accepted quotes without a verified priced snapshot are not backfilled or repriced. Existing invoices can be opened. New billing fails closed and explains that a reviewed draft and fresh approval are needed. Historical accepted totals are not reconstructed using current add-on prices.

Invoice drafting does not mark equipment as installed on the customer record.

## Scheduling

All write paths share a database guard. New jobs and calendar moves use server-validated commands; generic saves and Crown Care cannot bypass overlap validation. The guard validates appointment date/time, duration, current team identity and same-technician overlap. Technician selectors carry IDs so duplicate names cannot silently target the wrong person. Undated/unassigned drafts remain legitimate; explicit unassigned appointments can still be scheduled.

A private per-company mutex row serializes concurrent writes. Its version update also forces stale repeatable-read/serializable transactions to abort rather than checking an old snapshot. Only the service-only rescheduling command can apply an explicitly requested conflict override. Generic JSON cannot opt out. Existing scope, quote links, Crown Care linkage and unrelated legacy fields are preserved. Incomplete active legacy appointments remain visible in a review queue; a known date conservatively blocks same-technician bookings touching that day until staff enter a verified time. No time is silently invented. The Crown Care transaction rolls back both job and seasonal slot if appointment validation fails.

A genuine multi-session PostgreSQL 17.6 check confirmed conflicting transactions wait and then reject under READ COMMITTED (23P01), REPEATABLE READ and SERIALIZABLE (40001). Adjacent appointments committed successfully. These tests used a separate disposable local database, not the production project.

## Release order and scope

Apply `20261005234844_accepted_quote_invoice_integrity.sql` and `20261005235014_scheduling_write_integrity.sql` before deploying the matching app. Neither migration updates historical customer, quote, invoice, job, membership or payment rows. The new API fails closed if its migration is missing. Do not roll back to a permissive billing implementation; the database protections may safely remain in place during an app rollback, but older clients can receive validation errors.

The release does not enable payments, SMS, phone intake or automations, send documents, or import customers. It does not grant broader staff data access. New mutation RPCs are service-role-only and enforce company, actor and feature permissions; existing RLS still governs generic saves.

## Verification

- Isolated PGlite tests execute the original approval/payment RPCs together with the new guards, including immutable snapshots, legacy invoices, revisions, direct/generic tampering, tenant/permission checks and invoice uniqueness
- Mocked HTTP tests verify authoritative server payloads, authentication and feature permissions without any provider or production requests
- Interactive synthetic DOM QA exercises locked selections, repeated invoice clicks, revision Cancel/Close/Escape, pending dismissal, failure/retry idempotency, quote navigation and stale completion responses
- Local browser screenshot/visual QA was blocked by the environment; DOM interaction checks are not an authenticated production browser walkthrough
- Existing TypeScript, full test suite, dependency audit and production-build gates remain required for the exact release commit

All fixture names, identities and amounts used in testing are synthetic.
