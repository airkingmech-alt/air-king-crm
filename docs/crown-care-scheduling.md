# Crown Care seasonal visit scheduling

Use **Schedule Visit** on a membership card, or schedule immediately after enrollment.
Skipping enrollment's scheduling step leaves this return path available. Choose spring
or fall, date/time, and optionally a technician. An explicit appointment is Scheduled
even before a technician is assigned; the success message calls out that assignment gap.

The job stores `membershipId` and `membershipSeason`, and the seasonal visit stores its
`workOrderId`, date, time, and technician. The caller-scoped
`crm_schedule_crown_visit` RPC returns both saved records. Its transaction and a
security-invoker work-order trigger lock the membership, reject a second booking for
an occupied/completed season, and roll back the job if the membership update fails.
The dialog stays open on failure, retains the retry ID, and blocks repeated submissions
and dismissal while the save is pending. Schedule and Crown Care permissions are both
required for linked writes, including the server scheduling endpoint.

Later rescheduling updates the same seasonal slot. Completion increments `visitsUsed`
once, reopening reverses only that linked completion, and cancellation releases the
slot for a replacement visit. Editing an older cancelled job cannot overwrite that
replacement. Linked jobs cannot be hard-deleted or reassigned to another membership,
season, or customer. General unlinked jobs keep their existing behavior.

Apply `20260930212925_crown_care_visit_linkage.sql` before releasing the client change.
Without that migration, Crown Care scheduling fails closed. This patch does not apply
it to production. Existing description-only jobs and legacy seasonal history are not
backfilled or inferred; they need explicit reconciliation before automatic linkage.
Completed and legacy Scheduled slots remain protected from replacement.

Verification includes caller-RLS PGlite transaction tests, mocked scheduling API tests,
client request/confirmation tests, TypeScript, and the repository release check.
Source-level dialog guard checks are not a substitute for authenticated browser QA.
