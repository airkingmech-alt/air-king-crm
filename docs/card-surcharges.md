# Online credit-card fees — Air King

The owner requested a fee only when paying online, without a third-party surcharge service.

## Customer experience

The invoice and cash/check balance stay unchanged. Selecting online payment opens Stripe's
Payment Element. The customer enters payment details and selects **Review fee and total**.
The server retrieves a Stripe ConfirmationToken and determines funding type. Only verified
credit cards receive the configured fee (up to 3%); debit, prepaid, unknown funding and
non-card methods receive no added fee. The review shows principal, fee and total before
**Pay in full**. The customer can change method or cancel without being charged.

Invoice creation defaults to **Apply credit-card fee at online checkout**, at 3%. Uncheck
it to waive the fee on that invoice, or lower the percentage. This stores `cardFeePercent`
as policy; it never adds a fee line to the invoice principal. Existing invoices without
that field use the company setting. Invoices with an earlier generated manual fee line
are excluded from a second fee. No such invoices existed when this change was prepared.

## Configuration

- Keep the existing Stripe secret and webhook keys.
- Set `STRIPE_PUBLISHABLE_KEY` for the same account and live/test mode.
- Set `STRIPE_DIRECT_CHECKOUT_COMPANY_ID=air-king`.
- Company settings: `fee_enabled=true`, `fee_basis_points=300`, `fee_fixed_cents=0`.
- The business settings toggle can disable new fees. It does not rewrite payment history
  or previously reviewed/reserved payments.
- Receive `payment_intent.succeeded`, `payment_intent.processing`,
  `payment_intent.payment_failed`, and `payment_intent.canceled` in addition to the existing
  Checkout Session events. Keep the existing webhook endpoint/signing secret.

This uses Stripe's direct PaymentIntent surcharge API (`2026-08-26.preview`) with
`amount_details.surcharge.enforce_validation=enabled`. Stripe validates surcharge
eligibility and its technical maximum before authorizing a charge. No Yeeld or
InterPayments service is used. The prior hosted automatic-surcharge integration remains
inactive; do not set its `STRIPE_SURCHARGE_*` readiness variables.

The merchant must set fees no higher than its acceptance costs or applicable limits,
complete required acquirer/network notices and any waiting period, and maintain required
disclosures. This code does not send merchant notices. Stripe's technical cap is not a
substitute for those obligations. Regular Stripe processing charges still apply.

## Payment safety and recovery

- The server calculates the full remaining principal from the payment ledger, checks the
  reviewed amount, and atomically reserves it under an invoice row lock.
- Each ConfirmationToken can map to one reservation. Creation and confirmation have
  separate stable Stripe idempotency keys; creation/recovery alone never charges.
- Unconfirmed intent client secrets are never returned. Only `requires_action` responses
  expose a secret to Stripe.js for 3DS. Confirmation uses the server-selected token.
- Cash/check recording, another online attempt and amount edits remain blocked while
  an intent is active. Native reservations do not expire merely because a clock elapsed.
- Cancellation must succeed at Stripe before the reservation is released. Processing
  bank payments remain reserved until settled or genuinely cancelled.
- The worker and status endpoint reconcile server-retrieved successful intents. Abandoned
  non-processing attempts older than one hour are cancelled at Stripe before release.
- Webhooks and reconciliation verify intent identity, account mode, currency, principal,
  received total, surcharge amount/cap and credit funding. An atomic ledger function
  credits principal only, records the fee separately, and makes repeated events harmless.
- Payment history and automatic receipt emails include both principal and fee. Stripe's
  native surcharge receipts also itemize the surcharge.
- Refund through Stripe including the full fee on full refunds and a proportional fee
  on partial refunds. There is no new automatic CRM refund workflow in this change.

## Verification

TypeScript, production build, pure fee/verification tests, mocked API integration tests
(review, confirmation, retries, debit, altered totals, 3DS, cancellation), and PGlite
ledger tests (full balance, competing payments, idempotency, principal/fee separation,
service-only permissions). These do not constitute a real card transaction test.

References:
- https://docs.stripe.com/payments/cards/surcharge
- https://docs.stripe.com/payments/finalize-payments-on-the-server?platform=web&type=payment
- https://docs.stripe.com/payments/build-a-two-step-confirmation
- https://markate.freshdesk.com/support/solutions/articles/14000148134-include-payment-processing-fees-for-online-payments
