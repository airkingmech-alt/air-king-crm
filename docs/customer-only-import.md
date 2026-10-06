# Reviewed customer-only imports

The Markate import is an owner/admin operation. It does not import jobs, quotes, invoices, payments, files, notes, groups, marketing source, communication preferences, or consent.

## Review and mapping

Review a private source export, preserve customer IDs from the source, and separate definite additions, exact existing links, identity questions, and invalid contact values. Do not match people by name alone or silently fix an address or email. A shared name, email, or phone blocks insertion until reviewed.

`shared/customer-import.ts` validates the source format and maps:
- Display name, separate person/company names, and verified Residential/Commercial type
- Primary and additional contacts, with original labeled phone values
- Billing address separately from service properties, including apartment/unit and text postal codes
- Source Active/Pending status separately from sales-lead status
- Stable Markate customer ID and source export/batch provenance

No sales-lead stage is invented. Missing service addresses remain an empty property list. No billing address is assumed to be a service location. New source-scoped IDs are deterministic. Existing links add only provenance and preserve existing contact, property, equipment, and history fields.

## Protected execution

1. Keep exports, snapshots, and the reviewed manifest outside the repository and public logs.
2. Authenticate as an owner/admin with customer access. Read `GET /api/crm/customers/import/state` immediately before the final identity review.
3. Submit the reviewed source records, batch UUID, snapshot fingerprint, and exact expected create/link counts to `POST /api/crm/customers/import/markate`.
4. The server derives the company/actor from authentication and calls service-only SQL. Browser roles cannot invoke the import RPC or access private audit tables.
5. The database briefly serializes customer writes, compares the complete destination snapshot, checks identities/source uniqueness, and commits the entire batch atomically.
6. Same batch plus same request is replay-safe. Reusing a batch with different data is rejected. Another batch cannot relink the same source.
7. Verify returned counts, customer fields, source IDs, preserved existing rows, and no communications events/runs. Keep unresolved records private for later review.

## No-send and recovery

The import ledger and full pre-write customer snapshot are stored in `crm_import.customer_import_batches` and `crm_import.customer_import_rows`. The snapshot is captured before any writes in the same transaction. The exact prior row is also retained for an existing link.

The existing event-capture trigger suppresses only an exact new-customer payload recorded in the private import ledger for the current running transaction. A JSON import flag or custom session variable cannot suppress normal customer events. Global triggers and automations remain enabled. A final event check aborts the batch if customer communication events were generated.

Failed batches roll back fully. Recovery after a successful batch requires a separate reviewed operation: compare all affected current rows to the recorded after-images, preserve subsequent user edits and dependencies, and restore only the intended records. Do not delete newly created customer records that have since acquired business history. No automatic rollback/delete endpoint is exposed.

## Verification

Run `npm run release:check`. Synthetic API/PostgreSQL tests cover authorization, strict fields, complete snapshots, stale-state rejection, rollback, exact linkage, source uniqueness, replay, enabled automation fixtures, and ordinary-event behavior. Never use live customer data in committed tests or fixtures.

## Explicitly reviewed separate records

If the user reviews collisions and explicitly chooses separate customer records, an operational database owner may register a private `crm_import.customer_import_approvals` manifest. It binds the company, actor, batch UUID, complete pre-write snapshot, and exact ordered create payload (including every source ID and field). Record the raw source contact records, any explicitly authorized corrections, and the approval explanation there. Never commit this manifest or contact data to source control.

The application service can read these approvals but cannot create, alter, or remove them. Browser roles have no access. An approval allows only the exact create batch to pass name/email/phone collision checks; it cannot authorize links or overwrites. Altering any payload field, source ID, actor, snapshot, or operation rejects the approved batch. All original field validation, source-ID uniqueness, count checks, replay protection, full snapshot backup, and narrowly scoped no-send logic still apply. A different unapproved batch continues to reject collisions.

Email corrections are performed only when the user authorizes the exact rule. Preserve original source values and before/after corrections in the private approval audit. The ordinary importer continues to reject uncorrected questionable addresses. Neither this approval nor an import changes the source system, existing CRM customers, or communications consent.
