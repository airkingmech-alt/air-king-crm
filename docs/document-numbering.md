# Invoice and quote numbering

New documents receive an immutable `data.documentNumber`, independently per company and document kind: invoice `000001` and quote `000001` are distinct references. The number is assigned in the same PostgreSQL transaction as creation. A private counter row serializes competing allocations; unique indexes also enforce each displayed reference within its company/kind. Internal IDs remain unchanged in URLs, payment metadata, links and relationships.

Numbers have a minimum width of six digits. After `999999`, they grow to `1000000`, without truncation or reuse. Deleted/voided numbers are not recycled. Transaction rollback rolls back allocation. Raw conflicting upserts can leave gaps; numbering is unique and sequential, not a promise of gapless accounting.

The confirmed-save RPC serializes identical document IDs before checking for an existing record. An exact creation retry returns the original number even when the caller did not receive it. Changed payloads still fail compare-and-swap checks. Accepted-quote invoice conversion retains its existing idempotency; quote revisions get a fresh quote number even when copied data contains the parent's number. The client must use the server's saved record (including for newly created quotes).

## Historical records and cutover

The pre-release read-only audit found 15 invoices and 13 quotes, no `documentNumber` fields and no fully numeric existing references. Existing documents, including drafts, remain unchanged and continue displaying their original reference. Existing issued documents, acceptance snapshots, edit history, communications, payment links and share links are never renumbered. No historical backfill is included. Any future cosmetic renumbering of historical documents requires an explicit reviewed mapping and approval.

The migration reserves any existing numeric references by initializing each counter to their maximum (or zero when none). It briefly locks invoice/quote writes with a five-second lock timeout and fails transactionally if it cannot acquire the lock, encounters conflicting existing references, or detects an unexpected save-RPC definition. No document rows are updated. Allocation starts at `000001` for the audited company.

Release order: pass typecheck, isolated migration tests, full tests, audit, build and disposable PostgreSQL concurrency test; apply the reviewed migration; verify historical fingerprints and installed functions/indexes; merge the checked PR and monitor the existing Render service through `live`; verify app health and deployed assets. Older app code tolerates the additive field during rollout; the new UI falls back to IDs when absent. Open tabs may need a refresh to display newly assigned numbers.

Rollback: revert the app deployment if necessary, retaining the additive migration and all assigned numbers. Do not reset counters, remove numbers, or renumber already issued documents.

## Verification

- `node --import tsx --test tests/document-number-migration.test.ts tests/document-number.test.ts tests/card-checkout-api.test.ts`
- `node script/test-document-number-concurrency.mjs` requires Docker and starts/removes a disposable PostgreSQL 17 container. It tests 24 simultaneous independent creations and 24 identical creation retries over separate connections, legacy numeric reservation and independent counters. It never uses production credentials.
- `npm run release:check`

PDFs use the existing browser print layout, which now receives the same stored display number as list/detail and public customer views. Email/SMS templates and new Stripe descriptions use the display number; provider metadata and idempotency keys retain internal IDs. Existing sent messages and already-created provider intents are unchanged.
