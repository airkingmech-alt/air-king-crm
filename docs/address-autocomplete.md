# Optional address suggestions

Geoapify autocomplete is optional and safe-off when `GEOAPIFY_API_KEY` is absent.
Manual street, apartment/unit, city, state and ZIP entry works in every state,
including missing provider configuration, exhausted limits and database outages.
No account or API key has been created, configured, inspected or tested by this change.
No live customer address has been sent to Geoapify during implementation or tests.

## Behavior

- Used by Add Customer, inline Create & Select, and the customer profile's service
  and billing address editor. Saved address displays retain attribution.
  A conditional internal-app footer shows distinct source credits when saved
  provider-derived addresses are reused in list cards, customer pickers, Crown
  Care, dispatch and schedule. It contains no addresses or place identifiers and
  avoids nesting attribution links inside existing picker buttons or card links.
- Suggestions begin only after a user types at least three characters and pauses
  for 300 ms. Opening/focusing an existing record never sends its saved address.
- Up to five US results, with a Kansas City proximity preference, not a Missouri
  filter. Kansas addresses remain valid. Provider house number and street are
  used instead of `address_line1`, which can be an amenity name.
- Explicit mouse/touch or arrow-key + Enter selection fills street, city, state
  and ZIP. Missing locality fields are cleared rather than leaving old values.
  Apartment/unit stays separate and unchanged. Review and Save is still required.
- Escape dismisses/cancels a pending lookup; blur, unmount and newer typing abort
  the request. Responses carry a sequence guard against stale responses even
  when a network request cannot be cancelled. Enter with an open list does not
  accidentally submit the enclosing form. IME composition waits until finished.
- No-match and failure states keep manual editing available. An unavailable
  provider/quota stops further requests for that mounted editor session.

## Server and privacy

`POST /api/crm/customers/address-suggestions` uses existing verified Supabase
authentication, staff/company checks and the customers permission. It accepts
only a 3–250 character `text` field. POST and `Cache-Control: no-store` keep text
out of browser URLs/history, ordinary access logs and caches. The server never
logs typed text, provider URLs, credentials or raw provider errors; malformed
JSON error logging is redacted too. The request uses HTTPS, rejects redirects,
times out after five seconds, and does not automatically retry.

Only the server reads `GEOAPIFY_API_KEY`. Never configure it as a `VITE_` variable
or include it in source control, browser JavaScript, API responses or logs.
No new infrastructure is needed: the endpoint uses existing Express and Supabase.

The selected saved address carries `addressProvenance`; billing attribution uses
`billingAddressProvenance` alongside the strict billing address object. These
record Geoapify, selection time, optional place ID and bounded datasource name,
attribution, license and HTTPS URL. They do not store typed queries, coordinates
or raw responses. Manual correction retains provenance because other fields may
still be derived from the provider. Provider strings render as plain text;
attribution links reject credentials, scripts and non-HTTPS URLs.

Geoapify and OpenStreetMap attribution is always rendered for provider-derived
addresses, plus the returned source attribution. Any future exports or address
display must retain the same metadata and visible attribution. Current quote and
invoice views do not render customer addresses.

## Durable free-allowance guard

Apply the reviewed migration `20261008221059_address_autocomplete_quota.sql`
through the project's normal authorized migration process before activation.
It adds an RLS-enabled private timestamp-only ledger and a service-role-only,
security-invoker `crm_reserve_address_request()` RPC. Browser/anonymous roles
cannot call it or read the ledger. No production migration was applied here.

Every provider attempt first reserves one unit atomically under a fixed global
transaction advisory lock. Limits are 2,500 attempted calls per rolling 24 hours
and four per rolling second across staff, companies, browsers and app instances.
The ledger persists across restarts. Failed, timed-out and cancelled calls remain
counted. A future retry must reserve another unit. Old entries expire within the
locked reservation, requiring no cron job. A DB error or limit denial prevents
the provider call; there is no local-memory fallback that could bypass the cap.

Geoapify's researched Free plan offers 3,000 credits/day and five requests/second,
with one credit per autocomplete request. The lower application cap reserves
headroom; it is not a guarantee against fees on an already-paid/shared account.
Other applications using the same Geoapify account are outside this ledger.

## Activation checklist (separate approval/setup)

1. Confirm the Geoapify account is on the intended free plan, and check current
   pricing/terms and all other account/project usage. Prefer an account/allowance
   dedicated to this application; otherwise reserve headroom for other traffic.
2. Obtain the required authorization for account/key creation and persistent
   secret configuration, then use the authorized secure setup path. Do not paste
   keys into chat or commit them. Do not configure payment or a paid plan.
3. Apply the reviewed migration and securely set server-only `GEOAPIFY_API_KEY`.
   Confirm that deployment log/APM configuration does not log upstream URL query
   strings or request bodies for this endpoint. No raw address logging is needed.
4. Test with public Missouri and Kansas address samples only, after approval;
   check attribution, normalization, manual entry, quota exhaustion and timeout.
5. Verify the free account's actual usage and billing behavior before calling
   activation complete. This feature never changes the provider's billing plan.

## Verification

- TypeScript check; stubbed provider/API tests; in-memory PGlite migration tests
  for role privileges, RLS, shared lock, rolling limits and timestamp-only data.
- Customer regression tests cover explicit selection, unit preservation, separate
  service/billing provenance, manual corrections, cancellation and saved display.
- No live Geoapify calls. Browser interaction QA is still required when a browser
  is available; static/source assertions do not establish real keyboard, mobile,
  focus or screen-reader behavior.
- Manual QA: open an existing customer without typing (no lookup), type fewer
  than three characters (no lookup), type quickly (one debounced request), let an
  older response arrive last (ignored), press Escape during lookup, blur/cancel,
  choose Kansas result (KS retained), preserve unit, verify no autosave, and try
  every form without a key or after a forced quota/provider/database failure.

## Primary sources checked October 8, 2026

- https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/
- https://apidocs.geoapify.com/docs/geocoding/
- https://www.geoapify.com/geocoding-api/
- https://www.geoapify.com/terms-and-conditions/
- https://www.geoapify.com/pricing/
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/api/securing-your-api
