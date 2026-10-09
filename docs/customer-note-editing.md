# Editing customer notes

Click a saved note in either customer Overview or Activity Timeline, or focus it and press Enter, to open the same accessible editor. Save replaces only its text. Cancel, Escape, and Close discard an unsaved draft. Empty text cannot be saved. While saving, the text and buttons are disabled and dismissal is blocked; repeated submissions make one request. A failed save displays an inline error and retains the draft for retry.

The editor captures the note when opened. Query refreshes do not reset that snapshot or the draft. A user, company, customer, or note change resets the editor. A conflict retains the draft and refreshes the list; cancel and reopen after the refresh to review the latest text before editing again.

## Persistence and authorization

`updateCustomerNote` is separate from duplicate-ignore note creation. Its atomic UPDATE writes `{ text }` and filters by company ID, customer ID, note ID, and original text. Existing company RLS still authorizes the caller. This text comparison rejects competing replacements of a changed note; it does not introduce a revision history or distinguish intervening edits that return to exactly the original text.

The persisted result is verified before closing. A zero-row update reads the same scoped note and accepts it only if it already contains the intended text, making retries after lost write responses safe. Different stale drafts and missing or inaccessible notes reject. Author, date, ID, customer ID, company ID, and created_at are never updated. Edits stay in their original list position.

The cache cancels older reads, replaces the matching note in place only if the cache still contains the original or confirmed replacement text, and invalidates for a fresh read. It preserves a newer cached edit and never inserts a partial note list into an absent cache. User/company/customer keys isolate cached data; sign-in changes reject late editor operations.

No schema migration, production data operation, new application dependency, or environment variable is required. Mini Splits work is excluded.

## Verification

- `npm run check`
- `npm test` (includes synthetic Supabase requests backed by PGlite with the existing company RLS policies)
- `npm run build`
- `git diff --check`

The optional browser smoke test bundles the actual editor in an isolated synthetic harness. It verifies keyboard opening and focus restoration, Cancel/Escape without writes, blank validation, error draft retention and retry, both view instances, reload, duplicate submits, pending-save dismissal protection, stale snapshots and conflicts, scope reset, and literal text rendering. It uses local synthetic storage and blocks all non-local browser requests; it does not sign into the CRM or touch customer data.

Run from the repository root with Playwright available and Chromium installed. For an isolated install without changing package manifests:

```sh
npm install --prefix /tmp/note-browser-tools --cache /tmp/note-npm-cache --no-audit --no-fund playwright@1.64.0
ln -s /tmp/note-browser-tools/node_modules/playwright node_modules/playwright
CHROMIUM_PATH=/usr/bin/chromium node script/test-customer-note-editor.mjs
```

Adjust CHROMIUM_PATH to the local browser path, or omit it to use Playwright's installed Chromium. The component harness uses a fake save callback; database behavior and authorization are covered independently in `tests/customer-notes.test.ts`. A live CRM end-to-end smoke test remains a post-publication check requiring authorized synthetic records.
