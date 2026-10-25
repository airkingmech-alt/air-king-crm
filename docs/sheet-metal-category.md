# Sheet Metal & Sheet Metal Fittings

On 2026-10-25, 450 reviewed Air King price book records were reclassified from
`Ductwork & Fittings` into `Sheet Metal & Sheet Metal Fittings` using the existing
free-text category field. Their supported `part` item type was retained.
No schema changes were required.

The UI adds a dedicated section and excludes this category from the Parts section.
All items still includes every record. New items in the section default to the
new category and the `part` type. Existing supplier filters, product subcategories,
pagination, source links, missing-price handling, and import behavior are preserved.

## Verified production data result

| Measure | Before | After |
| --- | ---: | ---: |
| All price book records | 900 | 900 |
| Sheet Metal & Sheet Metal Fittings | 0 | 450 |
| Ductwork & Fittings | 515 | 65 |
| Records with part item type | 678 | 678 |

The category-only transaction targeted exact reviewed IDs and update timestamps,
locked those rows, and required exactly 450 matches. A separate post-commit read
compared all fields of all 900 records: only 450 category values and their automatic
`updated_at` timestamps changed. All IDs, prices, costs, SKUs, descriptions, metadata,
active flags and other details were unchanged. No inserts or deletions occurred.
Of the moved records, 157 were active and 293 were inactive; those flags were preserved.
Displayed counts follow the existing catalog visibility rules.

## Scope retained for review

65 duct-category records were left unchanged, including 44 flex duct/air connectors,
plastic or mixed-material vents, Therm-O-Pan products, and uncertain accessories.
Examples: 6-inch Plastic Dryer Vent Box, 2-inch Horizontal Vent Termination Kit,
Flue Assembly, and Transition Assembly 90+ RPJ3. The flex group includes one
V330 flexible compressed aluminum pipe; it was retained with that group pending
clarification of the desired flex classification.

Unrelated Parts inventory was untouched, including Universal Capacitor 15 Mfd,
T10 Pro thermostats, Universal Single Stage Fast Open Gas Valve, motors and controls.

The live category data is persisted. Until this UI change is approved and deployed,
the category is searchable and shown on item cards, but these records still appear
in the existing Parts tab because that deployed tab matches the part item type.
After deployment, the Parts section will have 228 total records before visibility
filters, with the 450 reclassified records in the new dedicated section.

Local audit evidence is retained outside the repository in
`/workspace/sheet-metal-audit/`: `before.json`, `after.json`, `selected.json`,
`reclassify.sql`, and `verification.json`. No customer communication, quote,
invoice, equipment record, or schema was changed.
