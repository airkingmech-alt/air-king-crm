# Service-only maintenance drafts

Two supported entry routes:
- Quotes → New Quote → choose customer → Maintenance — service only.
- Customer → New Quote → Job Type: Maintenance.

Enter the actual service scope and complete fixed customer total. For the requested furnace tune-up, the intended draft is heating only, one system, $99 total. This change creates no real customer draft and sends nothing.

No equipment, purchase-tax allowance, optional add-ons, or margin multiplier is added to this service-only path. An optional internal labor estimate never changes the customer total. Blank internal cost is stored as zero with an explicit review reminder; it is not an assertion that the service costs nothing. Saved proposals use maintenance terms instead of installation warranty and equipment promises. Normal equipment quotes retain their pricing behavior.

The existing Quote model, company-scoped record save RPC, and request-id protections are reused. No migration, auth changes, grants, credentials, provider configuration, or customer consent changes. The `servicePrice` input is transient; the final amount is stored in the existing option customerPrice field.

Validation: unit tests cover exact total, no surcharges, service scope, internal-cost separation, invalid/empty drafts and rejecting equipment overrides. `node tests/maintenance-quote-browser.mjs` uses actual quote entry pages and the normal DataProvider with synthetic local RPC data: both entry routes, saved proposal terms and $99 price, repeated clicks, failed saves, cancel/reopen, mobile bounds and navigation while saving. It never connects to production. Screenshot: `docs/screenshots/maintenance-mobile.png`.

Publication requires separate owner approval. PR51 and the Remember me PR are independent.
