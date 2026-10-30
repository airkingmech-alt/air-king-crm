# Multi-property Crown Care setup

Use one customer for the owner; keep each house as a separate service property.

1. Open the customer’s **Properties & Equipment** tab and choose **Edit customer**. Enter the owner / primary contact once. Add service addresses; each new row carries forward only city and state. Optional tenant, property-manager, owner or service contacts and access details belong to that property. Save changes before adding equipment. You can save a few houses and return later.
2. On each property card, choose **Add equipment manually**, or use the existing nameplate scanner. Save separate equipment records for each component. Filter size, quantity, instructions and location now belong to the saved equipment. Unknown values may remain blank, including quantity. A zero quantity is distinct from unknown.
3. Choose **Review Crown Care**. The owner is selected, memberships are scoped to that customer, and the property overview shows existing linked active memberships. Review existing coverage first; legacy memberships without a property link need manual review.
4. Choose **Enroll Customer** only when ready to review an enrollment. Select a property, then **Add this property's saved equipment**. This copies active equipment and filter details into the existing coverage form. Repeated clicks do not duplicate equipment. Existing coverage and edits remain intact. Unknown filter quantity is copied as zero with a visible “Verify filter quantity at visit” note; staff must review it.
5. For houses needing independent schedules, create a separate membership per house using the same owner. Select the existing plan, verify the complete-system count, agreed price and customer acceptance. A furnace and its matching AC are components of one complete system. Equipment entry does not choose a plan or change pricing.
6. Use the existing **Schedule Visit** action after enrollment. Booking stays protected by existing membership/season idempotency. Visit descriptions identify the property for each coverage item; scheduled job cards show current property contacts/access separately, with a link to equipment. Contact details and gate codes are not copied into invoice descriptions.

Profile changes do not silently rewrite saved membership terms or coverage. Update coverage explicitly when necessary. New contacts do not alter messaging consent. There is no automatic billing, message, enrollment or visit creation during property/equipment entry.

## Persistence and access

The implementation adds optional fields to the existing customer JSON: `properties[].serviceContacts` and equipment `filterQuantity`, `filterNotes`, `location` (using the pre-existing `filterSize`). It exposes existing `accessNotes`/`gateCode` in the customer editor. There are no new tables, migrations, RLS policies or grants. Customer edits still use `crm_save_records` with the captured original record, confirmed-save response, and duplicate-submit lock. Equipment still uses the company-scoped API and optimistic update check from PR #66. The scanner schema is unchanged, so confirming a scan preserves manual filter details.

Failed saves retain the open form. Lost-response retries reuse the same write/request ID. Cancel discards unsaved edits. Unsubmitted drafts are not persisted across a browser reload; save completed properties before leaving. Saved records reload normally. Concurrent changes produce a conflict instead of overwriting newer data.

## Verification

- `npm run check`, `npm test`, `npm run build`.
- `node script/test-equipment-editor.mjs`: existing real-component entry/scanner/edit/retry/mobile checks, with synthetic persistence.
- `node script/test-property-onboarding.mjs`: real customer/equipment/coverage editors at 390px and desktop; nine addresses, owner/tenant separation, failed and lost-response saves, repeated submit, cancel, reload, filter association and duplicate coverage prevention. Requires Playwright and Chromium (`CHROMIUM_PATH` can override `/usr/bin/chromium`), as does the existing browser harness.
- PostgreSQL tests execute the existing guarded customer RPC with synthetic nine-property data, company RLS, foreign-company rejection, stale writes, and retry checks. Equipment API tests verify persisted filter edits/clears and invalid quantities against disposable PostgreSQL. Coverage tests verify selected-property association and retained agreed edits. All data is synthetic; no live records are touched.

Release remains a separate approval: review/merge this branch, resolve the existing Render Git Credentials/deployment issue, deploy the approved commit, and smoke-test the released workflow. This work does not establish that PR #66 or this change is currently live.
