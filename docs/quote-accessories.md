# Quote installation accessories

New independent-option quotes load accessories from the signed-in company's live `price_book_items` table. No prices are seeded or modified by this change. Nothing is selected automatically. The existing equipment Accessory selector remains available for the legacy equipment catalog; the installation-accessory section below it supplies grouped, searchable live-pricebook choices.

Each selection snapshots its pricebook UUID, SKU, name, unit, quantity, internal cost, reference selling price, and source update timestamp. Quantity changes and edits use that saved price, not a later pricebook price. Remove/re-add an item to intentionally use its current catalog price. Duplicate options have independent snapshots. New drafts and their revisions expose accessory editing; older quotes retain their existing add-on workflow and prices.

Parts add supplier cost × quantity to the existing purchase-tax base, then use the existing 20% margin calculation. Their catalog selling price is retained as a reference, not mistaken for internal cost or marked up again. Installed services add their pricebook selling price × quantity directly to the option price, with no second margin or purchase-tax allowance. Service internal costs contribute only to internal totals. A zero service cost is explicitly flagged as incomplete; it is not presented as verified profit. An explicit option selling-price override still wins.

The remaining materials allowance is labelled **other materials, excluding itemized accessory parts**. Review an existing allowance when itemizing previously bundled parts. Additional parts-installation labor belongs in the option's labor field. The picker prevents choosing both a complete installed service and component parts in the same accessory group. The four installed accessory services are absent from the shared customer add-on catalog on new manual quotes, preventing a second charge after selection. Duct cleaning and membership add-ons remain on their existing workflow.

Missing records are shown by category as requiring pricebook data. Inactive/archived records, missing price/unit flags, zero parts cost, zero selling price, and invalid quantities cannot be selected. No generic substitute or free accessory is inserted. The grouping deliberately excludes replacement-part categories to avoid offering repair components as complete installation packages.

## Live catalog evidence, read 2026-10-29

| SKU | Item | Internal unit cost | Catalog selling price | Treatment |
|---|---|---:|---:|---|
| ADDON-surge-protector | HVAC Surge Protector | Missing (stored 0) | $199.00 | Installed service |
| ADDON-wifi-thermostat | Wi-Fi Smart Thermostat | Missing (stored 0) | $199.00 | Installed service |
| ADDON-media-cleaner | Media Air Cleaner | Missing (stored 0) | $549.00 | Installed service |
| ADDON-humidifier | Whole-Home Humidifier | Missing (stored 0) | $649.00 | Installed service |
| GNF5950 | General Filters 5950, 17 GPD bypass humidifier | $124.28 | $155.35 | Part, tax/margin calculation |
| RPC00600M | AprilAire 600M bypass humidifier | $252.81 | $316.01 | Part, tax/margin calculation |
| PRQT751I | PRO1 T751I Wi-Fi thermostat | $120.71 | $150.89 | Part, tax/margin calculation |

The live catalog contains 46 thermostat-category records and nine humidifier records; the picker reads eligible records dynamically rather than copying these example prices into application code. Installed-service rows do not identify exact device models. The older hardcoded add-on amounts ($299 surge / $399 Wi-Fi thermostat) are not used by the new per-option picker.

**Missing catalog data:** electrical whips, disconnects, equipment pads, line sets, condensate pumps and condensate safety switches returned no matching records, including metadata subcategories. There are no priced filter-cabinet hardware records; media cleaning is available only as an installed service. Adding verified supplier records with costs, selling prices, units, specifications and active status will make matching categories selectable. No production pricebook write is included.

## Research and practical selection

These are conditional installation choices, not a bundle for every bid:

- Whips and disconnects are sensible electrical hookup choices. Match gauge, length, fittings, amperage, voltage and enclosure to the job. [DiversiTech whips](https://www.diversitech.com/product-families/electrical-and-replacement-parts/whips-conduits-and-fittings) and [electrical products](https://www.diversitech.com/product-families/electrical-and-replacement-parts).
- Surge protection is a useful option, but select the actual device for the electrical system; the generic service record is not a device specification. [RectorSeal surge protection](https://rectorseal.com/hvac/hvac-installation/surge-protection/).
- Equipment pads depend on footprint, support and mounting conditions. [DiversiTech equipment pads](https://www.diversitech.com/product-families/equipment-mounting/pads).
- Condensate pumps depend on drainage, lift and application. Overflow switches provide condensate protection; inspect the drain/pan arrangement and control wiring. [DiversiTech pumps](https://www.diversitech.com/product-families/condensate-management/condensate-pumps), [RectorSeal condensate protection](https://rectorseal.com/blog/tag/condensate-switch).
- Thermostats depend on stages, heat-pump/dual-fuel operation, communicating controls and wiring; no universal compatibility is claimed. [Resideo compatibility guide](https://www.resideo.com/us/en/thermostat-wiring-compatibility/) and [T6 stage-specific product](https://www.resideo.com/us/en/pro/products/air/thermostats/programmable/t6-pro-programmable-thermostat-up-to-3-heat-2-cool-th6320u2008-u/).
- Humidifiers are appropriate when the home needs humidity and the duct, water/drain and control arrangement supports the chosen model. [AprilAire 600 product documentation](https://shop.aprilaire.com/products/aprilaire-model-600-humidifier).
- Line-set sizing and media cabinet fit must be reviewed against the selected equipment's installation instructions. These categories are exposed as missing where hardware is absent, not inferred from equipment tonnage.

## Persistence and delivery

Accessory descriptions and quantities are included in each saved option's homeowner equipment lines and equipment summary. Those same fields feed the staff proposal/print-to-PDF view, public proposal, accepted-scope snapshot, work-order scope and invoice description. Their prices are already included in the option total, so no second invoice line charge is added. Internal accessory snapshots are excluded from the public quote response. No schema or migration is needed.

Validation uses synthetic browser fixtures and disposable PostgreSQL only; no customer quote, acceptance, invoice or work order is created in production. Tests cover prices, quantity validation, missing prices, duplicate protection, independent totals, selling overrides, unchanged edits, quantity edits, JSON reload, public cost privacy, printable/public proposal text and PostgreSQL save/reload/acceptance/invoicing for all four options.
