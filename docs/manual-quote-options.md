# Independent quote options

New standard equipment quotes start empty. Staff add up to four independently priced options, with editable names, equipment selection, duplicate/remove controls, separate labor and materials, and an optional selling-price override. Stable internal option identities preserve existing selection, acceptance, invoice and schedule behavior. There is no automatic Guardian/Champion substitution, furnace upgrade, capacity rounding or coil replacement in this workflow.

Each option has independent 10-year parts and 10-year labor checkboxes. Parts coverage has no additional cost allowance. Labor coverage adds **$350** of untaxed cost before the selling-price calculation. Unchecked coverage is not promised in the option features. Registration and existing proposal terms continue to apply.

Potential Champion rebates use the reviewed 2026 model-family rules. Staff must confirm the suggestion for each option before it appears on the saved bid. Equipment changes and duplication clear that confirmation. Rebates do not reduce job cost or selling price. The published program window still applies. Manual equipment entries require explicit model/brand/category/description/cost and supplier review; they do not manufacture model rebate eligibility.

Current unrelated defaults remain $1,200 labor, $450 materials, 9% purchase tax on equipment plus materials, and job cost divided by 0.80. These preserve the existing CRM behavior rather than silently changing it to the quoting skill's different default labor/material/tax allowances. The owner's new $350 warranty instruction supersedes $250 for the independent manual workflow only. Existing quotes and separate new-house/maintenance workflows remain unchanged.

The customer's selected option determines the accepted price and invoice, plus explicitly selected add-ons. Alternative option totals are never added together. Internal costs and overrides remain private in public document projections. Saved manual options retain their own costs; title-only edits do not reprice historical options. Accepted records remain locked through existing server guards.

Draft 000003 is intentionally unchanged per the owner's latest instruction. No customer records are rebuilt by this change. No database migration is required: the existing four-option JSON structure and server guards accept the new option metadata and $350 allowance.

Validation includes real-priced model tests, all warranty checkbox combinations, independent overrides, invalid/missing costs, rebate confirmation/expiry, saved JSON reload, PostgreSQL save/accept/invoice tests for every option, custom names, mobile browser checks and PDF output. Browser fixtures use synthetic local data only.
