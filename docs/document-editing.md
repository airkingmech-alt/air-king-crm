# Quote, invoice, and customer editing

## Staff workflow

- Open a quote from Quotes or a customer record, then select **Edit Quote**. Unaccepted drafts and sent/declined quotes can be edited in place. Save does not send, accept, convert, enroll, or charge.
- Text-only changes retain saved prices and catalog snapshots. Prices are editable to the cent. Equipment recalculation is an explicit per-option action using current equipment costs, the entered labor/material costs, 9% purchase tax, and 20% margin. Changing models clears prior included features for fresh review; verify matching, capacity, efficiency, warranty, and availability before sending.
- Accepted quotes use the existing **Create draft revision** action. The original approval, job, and invoice remain separate; obtain fresh approval for revised work and reconcile the original billing separately.
- Open an unpaid invoice and select **Edit Invoice**. Names, project details, due date, and line descriptions/amounts can be edited; the total is recalculated in cents. Quote-linked invoices retain the approved name, scope, and prices and allow project/stage/due-date edits only. Invoices with a payment, partly paid invoices, paid invoices, and void invoices retain their billing history.
- Active online checkout reservations block scope/price/project changes. Finish or cancel the existing checkout through the established payment workflow before retrying; this editor never cancels a payment.
- Open a customer and select **Edit customer**. Edit the customer/company name, primary contact, each service location, and optional billing address independently. Apartment/unit fields, other contacts, installed systems, imports, and notes are retained. Existing documents and jobs retain their saved customer details.
- Address suggestions are optional and fail safely to manual entry until securely configured. See [address autocomplete](address-autocomplete.md).

## Persistence and security

`crm_edit_document` receives the complete opening snapshot plus a limited field patch. It locks the row, checks current staff/company/feature access under existing RLS, compares the original JSON, validates changes, and returns only the confirmed saved record. It also compares unchanged forms rather than restoring a stale opening snapshot to the local cache.

Server-generated `editHistory` records changed fields, before/after values, server time, and the authenticated actor. Prior audit entries cannot be supplied or rewritten by the editor. Customer edits use the existing atomic `crm_save_records` comparison and append a customer activity entry. No migration rewrites existing business data.

Forms remain open on failures. Duplicate pending submits are suppressed; Cancel discards the local draft; remounting another record resets the form. Confirmed results replace the local record immediately; reads started before the edit cannot undo the saved state.

## Release order

Apply `20261008211535_document_edit_guards.sql` before deploying the editor UI. The separate optional-address migration is documented in `address-autocomplete.md`. No automatic schema deployment is added. Keep the existing accepted-quote, balance, and checkout migrations in place.

## Verification

- `npm run release:check`: TypeScript, all Node tests, production dependency audit, production build.
- `tests/document-edit-migration.test.ts`: real disposable PostgreSQL (PGlite), existing RLS/acceptance/payment triggers, CAS, permissions, validation, audit, payment and accepted-scope guards. Never connects to live databases.
- `tests/document-editing.test.ts`: saved-price/model preservation, exact cents, changed-model feature reset, no-op CAS, invoice restrictions, and validation.
- `tests/document-editor-ui.test.ts`: renders actual controls and checks route wiring. This is not browser interaction testing.
- `tests/customer-editing.test.ts`: customer/address distinction, metadata preservation, repeated edits, validation and provenance.
- `node tests/document-editing-browser.mjs`: opt-in local synthetic browser smoke. Uses the real DataProvider create/save/reload lifecycle with local fixture storage, no real customers or remote providers. Covers create-draft/edit/reload, repeated submit, cancel/reopen, save failure, conflicts, and mobile dialog bounds. Requires a local Chromium/socket-capable environment; `--serve-only` opens the same manual QA fixture.

The implementation cloud executor could not launch Chromium because the OS rejected its required socket. Browser smoke is provided and syntax-checked but has not been run successfully there. Hands-on keyboard, focus, touch, browser navigation and responsive visual verification remain release checks in a supported browser environment.
