# Payments and communications implementation

Inspected master ee31e3e, the live public Supabase schema and company-scoped RLS, and Render Air King CRM (Node 20, npm ci --include=dev && npm run build, dist/index.cjs, auto-deploy master, free web service).

Reuse customers, quotes, invoices, work_orders, memberships and profiles. Existing entities are JSONB envelopes. Keep existing statuses (Won/Lost and Partial), with presentation labels and additional lifecycle timestamps. Preserve historical paidAmount as a labelled opening balance, never invent historical payment methods or dates.

Add a transaction ledger, hashed public document tokens, persistent communications, activity events, editable templates, company preferences, automation definitions and durable runs. All privileged actions are authenticated server routes or verified provider callbacks. Public responses are explicit allowlists: no costs, customer access notes, other customers or credentials.

Money is integer cents. Invoice locking and unique payment/provider keys make payment settlement atomic and idempotent. Checkout reservations avoid simultaneous open sessions and manual/online double collection. Stripe confirmation is exclusively a verified webhook. An unexpected late settlement is retained and flagged as overpayment, never discarded.

The queue claims rows atomically. Conditions, consent, enable switches and quiet hours are rechecked just before sending. Ambiguous provider timeouts are held for review rather than blindly resent (Twilio cannot guarantee exactly-once delivery). Provider delivery callbacks are authenticated and recorded. Separate marketing consent and global SMS STOP.

Templates and starters are editable and disabled initially. Transactional receipts use the same audited outbox. A scheduled worker must run outside the browser; support a secured tick endpoint plus one-shot worker entrypoint. Configure Supabase Cron + pg_net with a Vault-held worker secret, or a Render cron job. The free web process alone is not a scheduler.

Implement and validate on feature/payments-communications before merging. No test sends to existing contacts and no real-card tests. Provider-live tests require owner credentials and controlled test recipients. Surcharge configuration stays disabled unless eligibility can be enforced for credit cards; never surcharge debit/prepaid/unknown funding.
