# Crown Care coverage and pricing

## Staff workflow

Open Crown Care, find the customer, and choose **Edit Coverage & Price**. Add saved equipment from the customer profile or a membership-specific equipment/service item. Save equipment type, description, quantity, filter size/quantity/instructions, equipment notes, and general membership notes. Set the base price and an optional positive surcharge or negative discount, with its reason. The displayed total is the agreed price for the selected annual or monthly period.

New enrollments use the same editor. The original starting rates remain $189 annually or $15.75 monthly. Adding equipment does not silently increase the price. Annual value totals use each membership's actual saved price. Search includes equipment and service notes. New first-visit jobs include coverage/filter notes in their description; existing jobs are not rewritten.

## Design references

- [ServiceTitan service agreements](https://www.servicetitan.com/features/service-agreement-software): equipment/location coverage and agreement cost details.
- [Housecall Pro service plans](https://www.housecallpro.com/features/service-agreement-software/): customizable services, prices, and visit frequency.

This follows those patterns while keeping Air King's existing Crown Care workflow and branding.

## Data and security

Reuses `memberships.data`; no duplicate equipment or membership table. New optional fields: `coveredEquipment`, `notes`, `pricing`, and `configurationHistory`. Equipment references are checked against the same company's customer/property. Custom items are membership coverage snapshots, not new master equipment records. Legacy rows display their existing description and starting rate until edited; no bulk rewrite.

Server-side GET/POST/PATCH `/api/crm/memberships` routes require verified staff identity, company scope, and Crown Care permission. Prices are integer cents and totals are computed by the server. Save history stores actor, time, before/after configuration, and retry reference. Retry keys prevent duplicate enrollment/edit saves. Version checks reject stale edits. Completed visits, payment state, renewal dates, and other existing fields survive edits.

Migration `20260917183758_crown_care_configuration.sql` adds only an updated-at trigger using the existing `crm_touch_updated_at()` function. Existing rows and RLS policies remain unchanged.

## Billing boundaries

Saving coverage/pricing does not charge a card, send customer messages, update an existing invoice, or activate recurring billing. The auto-renew checkbox records a preference only. Existing Stripe-linked memberships are blocked from this editor pending a coordinated billing-change workflow. No new credentials or environment variables are required.

## Verification

Targeted automated tests cover permissions/company isolation, legacy prices, custom and zero prices, filter notes, preservation of completed visits/payments, invalid equipment and pricing, stale edits, duplicate retries, enrollment dates, and migration preservation/versioning. Full TypeScript/test/build checks run before release. Production checks are read-only; no customer messages or charges are generated. Authenticated hands-on browser QA requires an employee session.
