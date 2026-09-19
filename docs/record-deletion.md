# Customer, quote, and invoice deletion

Owners and administrators can open a customer profile, quote, or invoice and use **Delete** in the header. Confirmation is required. Feature permissions still apply.

Deletion removes the record from active screens and marketing audiences, but retains its database record and activity history. There is no permanent purge or user-facing restore in this release. Existing customer links are revoked; pending messages are cancelled; waiting/processing automation runs stop. Deletion waits for an in-flight message to finish instead of claiming it can recall a sent message.

Protected records:
- Customers with active quotes/invoices, jobs, memberships, payments, coupons, or referrals.
- Accepted quotes, recorded acceptances, or quotes linked to jobs/active invoices.
- Invoices with payments, any Stripe checkout attempt, or links to quotes/jobs. These remain available for financial and equipment history.

The database checks role/company/feature access, detects stale forms, records the deleting employee and timestamp, and rejects new work/messages/payments referencing deleted parents. Normal writes cannot restore or modify a deleted record. No existing records are deleted by the migration.

Validation: 149 automated tests passed, TypeScript check and production build passed. Six new database tests cover deletion, permissions, cross-company access, stale edits, history retention, link revocation, reminder cancellation, in-flight sends, accepted quotes, payments, checkout attempts, and deleted-parent protection. Signed-in user-interface verification remains an owner check.

Migration: `20260919180425_safe_record_deletion.sql`. No new environment variables.
