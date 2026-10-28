# Manual customer equipment

Open a customer → Properties & Equipment → Add equipment manually. Choose the property and equipment type, then enter any known brand/manufacturer, model, serial, capacity with units, manufacture year, efficiency with units, refrigerant, and notes. Save creates one distinct equipment record. Repeat for each unit, including several units of the same type at one property. Each record has Edit equipment; editing retains its property, ID, installation date, warranty, status, filter size, photo provenance and other stored fields.

Unknown nameplate details may remain blank. Equipment type and an existing property are required. Manufacture year must be an integer from 1900 through the current year; it is never used as an installation date. Inputs have matching client/server length limits. Cancel discards the draft; failed saves retain it. Conflicts refresh the profile but retain the draft, so close and reopen to review newer values.

## Persistence

The authenticated `POST /api/equipment/manual` endpoint uses existing `customers.data.properties[].systems` storage and company/customer permissions. It validates property and system association, compares editable original fields before editing, then atomically compares `updated_at` when writing the merged customer data. A concurrent write returns 409 rather than replacing newer data. Request IDs deduplicate retries after a lost response, including a creation retry after another edit, or a retry aimed at a different property. Existing nameplate scanning and photo confirmation remain separate and unchanged.

No database migration, new runtime dependency, environment setting, quote builder change or pricing change is required. No existing production records are rewritten by deployment.

## Verification

- `npm run release:check`: TypeScript, full automated suite, production dependency audit, production build.
- `tests/manual-equipment-api.test.ts`: real Express routes and Supabase client backed by synthetic PostgreSQL (PGlite); verifies fresh database reads, multiple records/properties, customer/company isolation, edit metadata preservation, original-value and concurrent-write conflicts, failure handling, idempotent retries, validation, and scan confirmation regression. No production/provider requests.
- `node script/test-equipment-editor.mjs`: actual components bundled with a synthetic API and browser local storage; validates creation, editing, reload, errors/retries, duplicate submissions, pending-save dismissal guard, cancel, conflicts, 375px mobile layout and scan/review/confirmation. Requires a production build for CSS, Playwright and Chromium. Screenshot: `/tmp/equipment-mobile.png` when run locally. The browser API is mocked; server/database persistence is covered separately above.

To run the optional browser harness without changing the application dependencies:

```sh
npm install --prefix /tmp/equipment-browser-tools --cache /tmp/equipment-npm-cache --no-audit --no-fund playwright@1.64.0
ln -s /tmp/equipment-browser-tools/node_modules/playwright node_modules/playwright
node script/test-equipment-editor.mjs
```

The default browser path is `/usr/bin/chromium`; set `CHROMIUM_PATH` to override. Live authenticated verification needs a designated synthetic customer; these tests do not modify real customer profiles or send messages.
