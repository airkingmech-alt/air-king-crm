# Mini Splits price book

The Mini Splits tab selects Equipment and Part records with category `Mini Splits`. Those records also remain in Equipment, Parts, and All items. Active counts, search, and archive visibility use the existing catalog records. Supplier subtypes appear as badges and are searchable; source correction notes are visible to staff separately from customer-facing descriptions. New items default to Equipment / Mini Splits. Switching between Equipment and Part retains that category; cancel and reopen resets the form.

No schema or permission change is required. Version-checked edits and archive/restore remain in place. Existing quotes, invoice lines, acceptance snapshots, and customer equipment are not updated. Invoice catalog selection uses the saved selling price and copies descriptions and prices into invoice lines. The separate static quote equipment catalog is unchanged; this import does not establish matched systems or add components to its package selectors.

## Private supplier import

Supplier manifests and PDFs must stay outside this public repository. The authenticated CLI reads a reviewed manifest from a private local path:

```sh
node --import tsx scripts/import-mini-splits.ts /private/manifest.json
node --import tsx scripts/import-mini-splits.ts /private/manifest.json --apply
```

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `AIRKING_IMPORT_ACCESS_TOKEN` in the environment. The token must identify an owner/admin with Price Book access. Company identity comes from the authenticated profile, and the existing database RLS policies still authorize reads and inserts. Never pass a service-role key or commit a token/manifest. Dry-run is default; the summary prints only company and counts.

The mapper accepts reviewed JSON `rows` with exact string models, supplier SKU, equipment/accessory source section, labels/descriptions, subtype, USD/each unit costs in decimal and integer cents, supplier/branch/date, file identity/page, and source notes. Unpriced, mismatched-cent, duplicate-model, duplicate-SKU, or unsupported-unit rows reject. Stock quantities do not affect inclusion. Models stay separate from supplier SKUs. The existing 20% margin calculation derives selling prices from supplier costs; no labor, installation, tax, compatibility, or matched-system package is inferred.

The importer pages through company records, including archived entries. It skips an existing case-insensitive SKU or same-brand/model without overwriting costs, selling prices, metadata, category, IDs, or archive state. Review skipped collisions before claiming a complete import. One atomic insert and the existing case-insensitive company/SKU index prevent duplicate inserts; rerun dry-run after a concurrent conflict or uncertain response. A subsequent import cannot reset staff price edits.

Production operations may use the authenticated database connector with a verified company/owner scope and the same validated mapper output. Preserve a pre-import catalog and quote/invoice checksum, insert only missing rows with RLS enabled, and verify every source model/cost, provenance, record count, unit/type, and unchanged historical records afterwards. No supplier values belong in a migration or public PR.

## Verification

Run `npm run release:check`, `npm run build:deploy`, and `git diff --check`. Synthetic tests exercise exact cents, category/type, stock independence, duplicate/retry behavior, company RLS, permissions, and collision preservation.

The optional browser smoke test uses the actual Price Book page with synthetic local storage and blocks all external requests. It checks tab counts, accessories, SKU/subtype search, add/cancel/reopen defaults, edits, archive/restore, metadata and reload. It also exercises the unchanged invoice-selection callback in an isolated harness to verify selling prices and copied line snapshots. It does not create or send a customer invoice.

```sh
npm install --prefix /tmp/mini-splits-browser --cache /tmp/mini-splits-npm-cache --no-audit --no-fund playwright@1.64.0
ln -s /tmp/mini-splits-browser/node_modules/playwright node_modules/playwright
CHROMIUM_PATH=/usr/bin/chromium node script/test-mini-splits-browser.mjs
```
