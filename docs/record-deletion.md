# Customer, quote, and invoice deletion

Owners and administrators can open a customer profile, quote, or invoice and use **Delete** in the header. Confirmation is required. Feature permissions still apply. The invoice card and invoice number now open the invoice; customer, Send, and PDF controls retain their separate actions.

Deletion removes the selected record from active screens and marketing audiences, while retaining its database record, original status, and activity history. Paid invoices, accepted quotes, and linked customers can be deleted. Linked jobs, other documents, signatures, equipment records, payments, memberships and financial reporting are not erased or cascaded. Deleting a customer does not cancel membership billing. There is no permanent purge or user-facing restore in this release.

Existing customer document links for deleted quotes/invoices are revoked; pending messages are cancelled; waiting/processing automation runs stop. Deletion waits for an in-flight message to finish instead of claiming it can recall a sent message. An already-open Stripe checkout can still complete. Its verified webhook updates the retained invoice/payment ledger exactly once without restoring the deleted invoice to active screens. Deletion does not refund payments.

Role/company/feature and stale-record checks remain enforced in the database. Normal employee edits cannot restore or change a deleted record. Internal payment settlement and the existing job-completion service-date update can maintain history. New public links, messages, acceptance and checkout creation against deleted parents are blocked. A replacement invoice may be created from the same quote/job after deletion; active duplicates remain blocked.

Migrations: `20260919180425_safe_record_deletion.sql`, followed by `20260919183211_flexible_record_deletion.sql`. No existing business records are deleted by either migration.
