# Credit-card surcharges — Air King

Status: implementation prepared; production fee collection remains OFF pending Stripe setup.
The approved policy is a credit-card-only merchant surcharge of up to 3%, never above
actual acceptance cost or applicable lower limits. No fixed fee. Debit, prepaid and
other payment methods carry no surcharge. Full invoice balance remains required.

## Activation

1. Sign in to the existing Air King Stripe account. Obtain Checkout automatic-surcharge
   preview access from Stripe. This is distinct from the public PaymentIntent surcharge API.
2. Install and onboard a supported surcharge provider (Yeeld or InterPayments) in Stripe.
   Review any provider price and terms before accepting. Configure its pre-charge policy:
   US/Missouri merchant, credit cards only, maximum 3%, no fixed fee, capped to actual
   acceptance costs and applicable lower limits. Verify merchant/acquirer notices and
   their required waiting period (Visa states at least 30 days). The CRM does not send
   notices or enroll in a paid service by itself.
3. Verify provider behavior in an authorized Stripe sandbox: credit at 3%, lower cost
   cap, debit/prepaid zero, Apple Pay funding eligibility, changing payment methods,
   failed calculations, disclosure before confirmation, cancellation, and itemized receipt.
   Verify the provider does not add tax or other charges outside the agreed total policy.
4. Verify hosted Checkout supports the API fields below on the account. Confirm preview
   response shapes against current documentation. Unit/PGlite fixtures are not a substitute
   for provider testing. Never test with test card numbers against live Stripe.
5. Only after these checks, set server environment variables:
   - `STRIPE_SURCHARGE_COMPANY_ID=air-king`
   - `STRIPE_SURCHARGE_READY_AT=<verified activation date in ISO 8601 UTC>`
   The date must reflect completion of provider setup and any required notice period.
6. Enable **Credit-card surcharge (up to 3%)** in Settings & Integrations. This saves
   `fee_enabled=true`, `fee_basis_points=300`, `fee_fixed_cents=0`. Without a reached
   activation date and correct company/Stripe configuration, enabling is rejected.
7. Verify a fresh customer invoice shows the policy before Checkout, Stripe shows the
   exact surcharge and total before payment, and a legitimately authorized payment
   credits only the invoice principal while separately recording the fee and receipt.
   Existing sessions retain the fee policy under which they were created until expiry.

Do not set readiness variables simply to bypass the disabled toggle. They attest that
Stripe/provider verification is complete. The provider enforces the cap BEFORE charging;
the CRM reconciliation checks are defense in depth and do not alter an already paid charge.

## Implementation

- Hosted Checkout uses `automatic_surcharge.enabled=true`, calculation basis
  `total_after_tax`, API version `2026-08-26.preview`, and disables Adaptive Pricing.
  The provider controls eligibility and the actual rate; Checkout has no percentage
  parameter in the documented automatic-surcharge integration. Invoice total already
  includes its taxes; the CRM does not add Stripe automatic tax.
- Customer policy disclosure appears on the public invoice and in Checkout submit text.
  Stripe renders the fee/total dynamically and provides itemized receipts.
- The full balance reservation snapshots a 0 or 300-basis-point cap. Existing zero-fee
  sessions and retries retain their original parameters/idempotency key.
- Signed webhooks retrieve preview fields directly when applicable, verify session,
  intent, currency, environment, total, base, fee breakdown and credit funding type.
- An invoice-locked transaction records the fee separately, credits only the principal,
  and updates receipt event metadata. Payment history and automatic receipt text show
  both principal and surcharge. Duplicate notifications remain idempotent.
- Zero-fee Checkout uses the stable SDK/API path. Disabling the feature affects new
  sessions; it does not rewrite historical payments or pending sessions.
- Refund through Stripe with the fee included: full refunds include the full surcharge;
  partial refunds include its proportional share. CRM automated refunds are outside
  this change. Follow existing refund/reconciliation procedures.

## Verification performed

TypeScript, production build, 45 focused tests (ledger locking/idempotency/access,
legacy payments, eligible and ineligible methods, cap/amount integrity, UI disclosure).
Live surcharged checkout and end-to-end settlement are NOT verified until activation.

References:
- https://docs.stripe.com/payments/checkout/surcharge/automatic-surcharge
- https://docs.stripe.com/payments/cards/surcharge
- https://usa.visa.com/content/dam/VCOM/global/support-legal/documents/merchant-surcharging-qa-for-web.pdf
