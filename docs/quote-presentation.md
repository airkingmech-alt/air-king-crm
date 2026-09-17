# Branded quote presentation

The staff proposal and secure customer quote use a shared Air King header, logo, contact block, guide, and footer. The design follows the red/gold treatment of the existing branded invoice. It keeps package comparison, optional upgrades, scope, total, and customer approval clearly separated. Customer links now offer Print / Save PDF using the browser print dialog. Print styles are scoped to quotes.

Sources reviewed September 17, 2026:
- [Jobber quotes](https://www.getjobber.com/features/quotes/): branded documents, package choices, optional add-ons, online approval.
- [Housecall Pro estimating](https://www.housecallpro.com/features/estimating-software/) and [estimate generator](https://www.housecallpro.com/tools/estimates-generator/): logo/contact header, customer details, clear scope/pricing, good-better-best and signatures.
- [ServiceTitan features](https://www.servicetitan.com/features): branded professional quotes and proposals integrated with sales workflows.

Existing prices, terms, signatures, sending, quote-to-job conversion, and invoice creation remain unchanged. The old staff footer's unverified license number and Kansas City location are replaced by the owner's supplied Turney address and contact information. Accepted customer quotes display their saved option and add-ons instead of transient unselected state. No database migration, new secrets, or customer messages are required.

Validation: TypeScript, regression suite, production build, and a synthetic server-render test of the actual customer document covering branding, scope, acceptance controls, print action, accepted saved add-on total, and removal of the unverified license. Local browser preview is unavailable in this environment; interactive visual/print pagination checks are not claimed.
