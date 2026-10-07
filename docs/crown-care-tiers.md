# Crown Care draft tier planning

This release publishes internal planning capability, not a launch of binding tier agreements.
Catalog `2026-10-draft-1` has draft annual prices per covered system of Bronze $199,
Silver $279 and Gold $349. All include two annual seasonal visits. Eligible repair
discounts are 5%, 10% and 15%. Silver and Gold add priority service and one $99
business-hours diagnostic waiver each year. Bronze uses homeowner-provided filters;
Silver/Gold supply and change one standard one-inch filter per covered system at
both annual tune-ups (two per system per year). Four-inch/five-inch filter supply
is excluded. No new discount caps, response guarantees or agreement terms are implied.

## Staff workflow

Crown Care displays the catalog with clear draft labels. Existing memberships retain
all agreed prices, coverage, visits, payment state and billing links. Edit an existing
membership to record a **draft tier interest** and covered-system count separately
from its agreed membership configuration. Server-generated snapshots retain the catalog
version, price and benefit definitions in existing configuration history. Removing the
draft selection clears the current selection while preserving history.

New enrollment with a draft tier is rejected by the server. Existing individually
agreed/legacy enrollment remains available; staff must not use it to bypass draft tier
approval. Draft interest is not an active plan, agreement, acceptance, renewal, billing
change or customer communication. Stripe-linked membership editing remains blocked.

Leads show a Crown Care inquiry badge and complete submitted details. Staff can review
or correct proposed tier interest in lead details with existing company-scoped optimistic
concurrency protection. Next: confirm the requested systems and service needs, complete
cost review and agreement terms, then approve a separate enrollment workflow. Creating
a customer remains an explicit staff action and does not create a membership.

## Website contract (website publication is separate)

Reuse the existing server-only website bridge and `POST /api/public/leads/website`,
with its existing `X-Lead-Token`. Never put that token in a browser bundle. Reuse the
existing durable website outbox and stable `source_ref` for retry deduplication.

Body uses existing name/contact/address/service_type/message fields and:

```json
{"metadata":{"crownCare":{"tier":"silver","catalogVersion":"2026-10-draft-1","systemCount":2}}}
```

`systemCount` is optional and must be an integer 1–100 when supplied. The range is a
technical input limit, not a promised commercial coverage limit. Tier and version are
required if `crownCare` is present. Do not send prices, benefits, enrollment state or
other extra fields inside `crownCare`: they are rejected. Other metadata is preserved.
The CRM creates a trusted catalog snapshot with `intent: inquiry` and draft status.
Unknown tiers/versions and malformed counts fail before insertion. Existing generic
lead submissions remain unchanged. No automatic customer creation, membership,
billing, SMS, Quo messages or other communications are added by this release.

## Remaining decisions

Draft rates need loaded labor/travel, filter and expected benefit-use costing. Two
one-hour visits including travel mean two annual hours before other costs. Define the
covered-system unit, eligible repairs, service territory/priority rules, final agreement,
renewal/cancellation treatment and activation criteria before binding enrollment.
Those undecided business terms are deliberately not invented in this release.

## Deployment and verification

No schema migration, RLS change, dependency, token, permission or environment change.
JSONB membership/lead envelopes and existing version checks are reused. No production
customer records are rewritten. Synthetic tests cover catalog values, input tampering,
legacy preservation, snapshot round-trip/removal, and enrollment rejection. Full release
checks and Linux/Windows CI are required before merge. Live verification is read-only;
no production inquiry, customer, membership, charge or message is submitted for testing.
