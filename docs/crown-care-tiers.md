# Crown Care published tiers and versioned pricing

The owner-approved first published catalog is `2026-10-08-1`:

| Plan | Annual price per covered system | Eligible repair discount | Priority service | Diagnostic waiver |
| --- | ---: | ---: | --- | --- |
| Bronze | $199 | 5% | No | None |
| Silver | $279 | 10% | Yes | One $99 business-hours diagnostic fee per year |
| Gold | $349 | 15% | Yes | One $99 business-hours diagnostic fee per year |

All plans include two seasonal tune-ups each year, spring and fall. Bronze changes
homeowner-provided filters. Silver and Gold supply and change one standard one-inch
filter per covered system at each tune-up, two filters per system per year. Four-inch
and five-inch filter supply is excluded. This release does not invent repair-discount
caps, priority-response guarantees, cancellation terms, or additional agreement terms.

## One current catalog, prospective edits

`GET /api/crm/crown-care/catalog` requires authenticated staff with Crown Care access
and returns `{catalog, version}`. `catalog` contains `version` and a `tiers` object
keyed by `bronze`, `silver`, and `gold`. The response's `version` equals
`catalog.version`; clients must use the fetched version, not a hard-coded constant.

Only the `owner` role may `PATCH /api/crm/crown-care/catalog`. Send a UUID
`Idempotency-Key` and all three annual per-system prices in integer cents:

```json
{"version":"2026-10-08-1","prices":{"bronze":19900,"silver":27900,"gold":34900}}
```

Prices must be 1–1,000,000 cents. This is an input-safety bound, not a promise about
commercial pricing. Each confirmed save publishes a fresh opaque catalog version.
The endpoint returns the current `{catalog, version}`. Retrying an identical request
key does not publish another version; changing its payload returns 409. A stale
version or competing save returns 409 with code `CROWN_CATALOG_STALE`; refresh,
review the latest prices, then make a new save. Never overwrite a later owner edit.

Each edit records its actor, timestamp, request key/hash, complete before snapshot,
and complete after snapshot. A database trigger requires append-only history.
Catalog edits do not read or update memberships, saved inquiries, charges, settings,
renewal choices, visit history, or customer communications. Existing agreement
prices and benefits remain the terms saved at enrollment.

## Enrollment and existing memberships

New tier enrollment uses a required explicit selection:

```json
{"tier":"silver","catalogVersion":"2026-10-08-1","systemCount":2}
```

The enrollment server requires an integer covered-system count of 1–100, records
coverage separately, and loads the current company catalog. Equipment components are
not equated to complete systems (one furnace plus its matching AC can be one system).
Client-submitted plan prices, discounts, totals, and benefits are never authoritative.
A stale catalog version is rejected so staff can review the new price before accepting.

Staff record customer acceptance explicitly (`accepted: true`, acceptance date, and an
optional reference) and the membership start date. Acceptance is a staff-entered
record, not an electronic signature or proof of payment. The server saves an immutable
`tierPlan` snapshot containing its catalog version, covered-system count, annual rate,
annual total, and included benefits. It starts with pending payment and unused visits;
automatic renewal defaults off and remains an explicit enrollment choice. Enrollment
creates no charge, Stripe subscription, email, SMS, or other message. Retrying the same
successful enrollment uses the original confirmed membership even after catalog prices
change; it must not create another membership or reprice the saved one.

Existing legacy agreements keep their agreed pricing and normal editing workflow.
Existing published tier memberships retain their saved plan and price snapshot during
allowed edits. Changing coverage count or terms requires a separate reviewed renewal or
change workflow; silently applying today's catalog is prohibited. Stripe-linked pricing
still belongs to its existing billing workflow.

Historical draft snapshots use `2026-10-draft-1`. The original draft schemas/helpers
remain frozen so historical planning records still round-trip without repricing.
They do not become active memberships, and new enrollment cannot use that draft version.
Leads display saved inquiry information; reviewing a proposed plan uses the live catalog.
Customer conversion remains an explicit action and does not itself create a membership.

## Website catalog and inquiry contract

The website server bridge calls `GET /api/public/crown-care/catalog` using the existing
website `X-Lead-Token` (the same token/source as website intake). Never expose that token
in a browser bundle. The endpoint returns:

```json
{"catalogVersion":"2026-10-08-1","plans":[{"id":"bronze","name":"Bronze","annualPrice":199,"repairDiscount":5,"filter":"Change homeowner-provided filter at tune-ups","priority":false,"diagnosticWaiver":""}]}
```

The real response includes all three plans. `annualPrice` is dollars, `repairDiscount`
is percent, and `diagnosticWaiver` is empty for Bronze or exactly
`One $99 business-hours diagnostic fee waived per year` for Silver/Gold. The response
contains no staff identity, internal edit history, lead token, or payment configuration.
Catalog endpoints disable caching; the website must refresh current version/prices
before presenting a new selection and handle stale versions at submission.

Submit inquiries through the existing `POST /api/public/leads/website`, existing
server-only bridge, durable outbox, and stable `source_ref` for deduplication. Existing
name/contact/address/service_type/message fields are unchanged. Add:

```json
{"metadata":{"crownCare":{"tier":"silver","catalogVersion":"2026-10-08-1","systemCount":2}}}
```

For inquiries only, `systemCount` is optional and must be an integer 1–100 when supplied.
Tier and current catalog version are required whenever `crownCare` is present. Prices,
benefits, enrollment state, and other extra fields inside `crownCare` are rejected.
Other metadata is preserved. The CRM snapshots trusted current prices and benefits
with `intent: inquiry`, `enrollmentAvailable: false`, and an inquiry-only notice. Without
a system count, the annual total is `null`; the server does not guess coverage.

A stale published or draft version returns HTTP 409, code `CROWN_CATALOG_STALE`, and a
message to refresh and review current plans. This is a review-required outcome: refresh
and have the customer confirm the updated selection rather than blindly retrying the
old outbox payload. Invalid selections fail before insertion. Generic inquiries without
`crownCare` stay compatible and do not depend on catalog availability. No inquiry creates
a customer, membership, charge, email, SMS, Quo message, or other communication.

## Deployment and verification

Apply `supabase/migrations/20261008031154_crown_care_versioned_catalog.sql` before
publishing the backend, then publish the website using the shared live endpoint. It adds
the `crown_care_catalogs` table, an invoker audit-history trigger, and an invoker
membership-terms guard. The guard also protects direct authenticated writes and legacy
invoker save RPCs: it prevents bypassing staff enrollment and preserves agreed plan,
price, count, acceptance, customer ownership, and renewal terms. Harmless existing-tier
notes, component coverage, scheduling, and checklist writes remain supported; legacy
pricing remains editable. Migration lock waits are bounded to five seconds and total
statement duration to two minutes. No existing rows are rewritten. RLS is enabled;
`anon`/`authenticated` receive no table grants. Only the existing server service role may
read/insert/update. All endpoint reads/writes are company-scoped; only an owner can save.
No row initially exists: the server uses immutable first-published defaults until the
owner's first edit. A missing table or database failure returns 503 instead of falling
back to obsolete prices. No new runtime dependencies, tokens, or environment variables
are needed. Rollback must preserve the catalog table/history and saved snapshots.

Synthetic API/shared tests cover approved benefits, tampering, optional inquiry count,
required enrollment count, version conflicts, owner authorization, tenant isolation,
concurrent writes, idempotency, exact prior snapshots, and generic-intake compatibility.
Disposable PGlite tests execute the migration, assert grants/RLS and invoker security,
prove append-only history and direct-client/RPC agreement protection, and compare
unchanged legacy membership/settings fixtures. Tests seed Supabase-style default grants
to prove catalog DELETE/TRUNCATE privileges are explicitly removed from the service role.
Run the repository's full release checks and required CI before publication. Verify
`GET /api/health` against the expected deployed commit (`commit` is Render's public
`RENDER_GIT_COMMIT`, or null outside Render). CRM live verification remains read-only. Do not
create production inquiries, memberships, charges, or messages merely to test a release
without explicit authorization for those synthetic tests.
