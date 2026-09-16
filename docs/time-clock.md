# Employee Time Clock

Time Clock is available in the sidebar and at `/#/time-clock`.

- Employees use their own CRM sign-in. Clock In and Clock Out save server timestamps immediately; the browser can close during the shift.
- My hours defaults to Monday–Sunday in America/Chicago. The date filter supports up to 31 days. Completed and running time are separate. Overnight shifts are included only for the portion within the selected dates.
- Edit corrects an existing shift, including a forgotten clock-out. Add Missed Time records a completed shift that was never clocked in. Both require a reason. History retains before/after times, notes, actor, and reason.
- Owners and admins may view, export, and correct any employee in their company. Other staff see only their own entries.
- Team permissions include Time Clock and Correct own time entries. Owner access is retained; owner/admin correction access does not depend on the own-entry toggle.
- CSV export uses Central Time and labels running entries provisional. Display totals are hours/minutes; underlying records keep exact timestamps and CSV hours use four decimal places. No rounding policy, automatic breaks, overtime, approval, payroll sync, or GPS tracking is applied. Clock out and back in for unpaid breaks.
- Daylight-saving gaps are rejected. For a repeated fall-back hour the correction form asks which occurrence to use.

## Architecture

The additive migration `20260916215625_employee_time_clock.sql` creates `employee_time_entries` and `employee_time_events`, linked to existing `profiles`. It changes no existing data. RLS is enabled and browser roles have no table access. All API reads check the current staff profile and company; employees cannot enumerate coworkers' records. Only the server service role can execute `time_clock_write`.

`time_clock_write` saves the time change and its history in one transaction. Advisory locks serialize changes per actor and employee. A partial unique index permits one running shift per employee. Overlapping shifts, future/invalid times, stale versions, and reused request keys with different payloads are rejected. Successful retries return the original result. An old clock-out request targets a specific entry/version and cannot end a newer shift. Normal server credentials cannot update/delete history or delete time entries.

Endpoints:
- `GET /api/time-clock?from=YYYY-MM-DD&to=YYYY-MM-DD&employee=UUID|all`
- `POST /api/time-clock` with `Idempotency-Key` UUID and action `clock_in`, `clock_out`, `create`, or `edit`.
- `GET /api/time-clock/:id/history` (latest 100 events; earlier events remain stored).

No new environment variables, outside subscriptions, scheduler, or integration credentials are required.

## Release and verification

Apply the additive migration before deploying the code. If a rollback is needed, roll back the application and retain the two tables to preserve time records.

Tests in `tests/time-clock.test.ts` exercise the actual SQL in isolated PGlite: clock-in/out, idempotency, stale versions, own/team/cross-company authorization, forgotten clock-out, invalid/future/overlapping entries, permissions, audit atomicity, denied browser database access, overnight totals, and daylight saving changes.

Design references: [Jobber time tracking](https://www.getjobber.com/features/time-and-job-tracking-software/) and [Housecall Pro time tracking](https://www.housecallpro.com/features/time-tracking/). The implementation uses their simple clock/timesheet approach while matching the existing Air King navigation and controls.

Release checks on September 16, 2026: 105 existing/new suite tests plus 5 additional HTTP authorization tests passed; TypeScript and production build passed. The migration was applied and table privileges verified on Supabase. A server-role clock-in/out and duplicate-request smoke check ran inside a rolled-back transaction, leaving no employee hours behind. Browser access to the local preview was blocked in this environment, so signed-in visual testing remains an owner check after deployment.

Security advisors: the two new tables report informational [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), intentionally denying direct browser access. Existing project warnings remain for [the company-lookup SECURITY DEFINER function](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No new warning/error finding was introduced by the time clock.
