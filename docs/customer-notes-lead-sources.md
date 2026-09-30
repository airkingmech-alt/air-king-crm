# Customer notes and unknown lead sources

## Repairs

- Customer detail now loads notes from the database when opened, reopened, or refreshed. Previously the page only read an initially empty in-memory array and never invoked its lazy loader. A note could be stored correctly but disappear from the screen after reload.
- Notes and Activity Timeline share the same company/user/customer-scoped query. Reads are paginated, ordered newest first, and display loading or an error with a Retry button rather than treating a failed read as an empty history.
- Saving a note now reads back the persisted row before showing success. A rejected write, ignored conflicting note ID, or missing/inaccessible readback leaves the form's text available for retry. An interrupted request retains its ID, so retry does not create another note. An older in-flight read cannot erase a newly confirmed note from the cache.
- All customer creation entry points default to `Unknown`. The full Add Customer form offers `Unknown / not recorded`, and the save boundary normalizes missing/blank sources to `Unknown`. Explicit selections and imported source names are preserved. Existing customer sources are not rewritten.

## Deployment

No database migration, new permission, environment variable, or dependency is required. The existing `customer_notes` table and caller RLS are retained.

After deployment, reload affected profiles before adding a replacement note: earlier notes may already be stored and will now become visible. Repeated attempts may have created duplicates. Do not delete or rewrite existing notes or historical sources automatically.

## Verification

`tests/customer-notes.test.ts` exercises the real Supabase client against a synthetic PostgREST adapter backed by PGlite, using the repository's existing note schema and company RLS policies. It covers storage and fresh reads, company/customer isolation, failure and interrupted-response retries, duplicate handling, pagination, query mount/revisit/reload, visible read failures, stale-query cancellation, and page wiring.

`tests/customer-lead-source.test.ts` covers normalization, preserved known/custom sources, all creation/reset defaults, and the explicit Unknown option.

Owner/browser smoke test after deployment:
1. Open an affected customer and check both Notes and Timeline. Reload and open a fresh tab; the same saved notes should remain visible.
2. Add one authorized note, then reload and verify its exact text appears once. On a controlled failed save/read, the UI should show the error and retain the draft or offer Retry.
3. Open Add Customer: source should start at Unknown / not recorded. Select a known source and confirm it saves unchanged. Quick-add customer flows should use Unknown when no source was collected.
