# Draft quote pricing and actual equipment tiers

New quotes save as Draft. Creation does not deliver a customer message. Automated quote messages are blocked while the quote remains Draft, including outbox messages queued earlier. The existing explicit Send action still performs document delivery and only successful delivery transitions the quote to Sent. No migration or historical repricing is included.

Purchase-tax allowance: round 9% of equipment plus purchased materials to cents, add untaxed labor, then divide the entire internal cost by 0.80 for the 20% margin. Round the final selling price to cents. Both builders, saved options, staff presentation/print, public proposal, and invoice conversion use the same saved cent-valued price. This allowance is internal job cost, not a separate customer sales-tax line.

For Champion XC3/XC4 baselines, options use actual same-capacity XC3 and XC4 catalog equipment. The owner-approved XC6 rule steps a half-ton baseline up to the next whole ton, with the actual capacity and two-stage equipment clearly labeled. A step-up is omitted unless the reviewed match table identifies a matching indoor coil and furnace and the catalog contains an unambiguous priced coil. No invented XC642, arbitrary price multipliers, silent indoor substitutions, or promised Wi-Fi upgrades. Other equipment selections remain a single selected-equipment option. Missing tiers are flagged internally. Manual supplier stock/field-fit review remains required.

Reviewed combinations are recorded with primary AHRI record links in `client/src/lib/quote-matches.ts`. These currently cover one 80,000-BTU furnace with 3.5-ton XC3/XC4 and the 4-ton XC6/4-ton coil. Other combinations are not claimed certified. Pricebook costs remain the existing supplier source; no live stock guarantee is implied.

Each saved option has its own equipment IDs and actual equipment cost/tax. Staff/public rendering, job-to-invoice conversion and the dashboard equipment-order list honor the selected option's IDs. Legacy quotes preserve their saved prices and existing rendering path. Internal cost, tax and review notes stay out of public responses and print output.

Validation covers tax base, no labor tax, cents rounding, independent tier prices, explicit model/coil selection, missing/ambiguous matches, single-option fallback, no mutation of historical records, public cost sanitization, both creation paths, draft automated-delivery suppression and explicit delivery.
