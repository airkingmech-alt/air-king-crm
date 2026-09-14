# Inventory implementation plan

Status: inspected and planned; no inventory production changes applied.

## Verified existing integration points

- React, Wouter hash routing, TanStack Query, existing Tailwind/Radix components.
- Express CRM API validates Supabase sessions and company-scoped profile roles.
- Supabase customers, work_orders, quotes and invoices use text IDs, company_id and JSONB data. Profiles use UUID IDs.
- Customer equipment is embedded in customers.data.properties[].systems[]. Preserve those records and property associations.
- Pricebook is a TypeScript catalog, not a database stock ledger. Link optional pricebook identifiers to inventory items; never treat catalog entries as physical stock.
- Invoice creation currently adds equipment to the first customer property and deduplicates by model. Serialized installation must identify the actual property and equipment record, never deduplicate distinct units by model alone.
- Live public schema inspection found no inventory, vendor, purchase-order or stock tables. Existing tables have RLS enabled.

## Delivery sequence

1. Transactional foundation: catalog, locations, stock policies, balances, immutable movement ledger, role enforcement, idempotency and concurrency tests.
2. Purchasing: vendors, item/vendor mappings, POs, partial receiving, serial capture and weighted-average acquisition costs.
3. Truck workflows: templates, restock suggestions, reviewed transfers, in-transit accounting, destination receipt, counts and administrator approval.
4. Job workflows: reservation, confirmed consumption, returns, material cost and sales snapshots, serialized installation into existing customer equipment.
5. UI and reporting: Inventory sidebar, dashboard drilldowns, catalog/equipment, shop/trucks, restock, transfers, vendors/POs/receiving, counts/history/reports/settings; mobile manual search plus capability-detected scanning.
6. Verify locally, inspect RLS/advisors, apply additive migrations, merge tested code and verify Render. Never send vendor POs or customer communications during tests.

## Data and transaction rules

- Every stock balance is per company/item/location. Movement rows are append-only; corrections are new reversing movements.
- Use exact numeric quantities for refrigerant and bulk materials; integer quantities for serialized units. Use integer minor currency units and explicit rounding for valuation.
- Available = physical on hand minus active reservations and transfer commitments. Reservations do not move physical stock.
- Transfer draft/ready/picked stages do not credit destination stock. Dispatch debits source and credits a transit holding location; receipt debits transit and credits destination. Partial receipts remain open. Dispatched transfers cannot be silently cancelled: require a documented return or discrepancy resolution.
- Lock impacted stock rows in a stable order; validate availability inside the transaction. Reject negative physical stock and duplicate dispatch/receipt/usage requests.
- Unique operation keys persist with payload fingerprints. Replaying an identical operation returns its original result; reusing a key with changed content fails.
- Receiving records quantities and cost at the time of receipt. Transfer preserves cost basis. Job usage snapshots acquisition cost and selected selling price without altering existing quote pricing.
- Quotes never decrement stock. Reservations link to existing jobs. Confirmed usage consumes reservations once and records customer, job, technician and optional invoice linkage.
- Serialized equipment has one current location/status, a company-scoped unique serial identity, and explicit installed customer/property/system links. Installation is atomic with stock consumption. Update an explicitly matched provisional equipment entry or append a new one; ambiguous legacy matches require staff review.
- Counts record observations, expected quantities and movement version. Posting requires administrator authorization and rejects stale counts pending reconciliation.
- Cross-company references are rejected at database and API boundaries, including jobs, customers, invoices and technician assignments.
- Anonymous users receive no inventory access. Staff reads and writes are role/location scoped. Technicians may use assigned stock and submit counts; unrestricted adjustments, costs, purchasing and approvals require appropriate elevated permissions.
- Restock and purchase suggestions are reviewable drafts. Never transmit a vendor order automatically.
- Historical recommendations require sufficient history and explain the usage window. Empty history does not imply zero demand.

## Acceptance tests

- Two simultaneous uses of the last item cannot both succeed.
- Duplicate receiving, transfer dispatch, receipt, count posting and job usage cannot change stock twice.
- Partial receipts reconcile ordered, received and remaining quantities.
- Transfer totals reconcile source, transit and destination; allocations prevent double-promising stock.
- Two distinct serials of the same model remain separate installed units.
- Technician cannot post adjustments, access another company's records or consume another technician's stock without authority.
- Stale counts are rejected; approved adjustments create attributable ledger entries.
- Desktop/mobile workflows and existing invoice payment, quote, customer and automation tests remain green.

## Source completeness

The supplied specification ends at “System shows the normal stocked items” in Friday Truck Count. Remaining instructions have not been provided. The visible requirements specify mobile counts and administrator approval and can guide that workflow pending the remainder.
