# Quote labor descriptions

Available in both quote flows: Quotes → New Quote, and Customer → New Quote → final Add-ons & Pricing step.

1. Select equipment and any add-ons.
2. Choose an optional starting description: full system, AC and coil, furnace, heat pump and air handler, mini-split, or service/repair.
3. Enter the job scope, existing equipment to reuse, access details and exclusions.
4. Choose **Generate with AI**, or **Use template** without AI.
5. Edit the preview, then choose **Use this labor description**. The normal labor description remains editable before saving the quote.

Generation does not save, send, change prices, or replace existing text automatically. Changed equipment/scope invalidates an old draft. The final approved text is saved in the existing quote laborDescription field and uses the existing quote→job/invoice flow.

AI uses the existing Anthropic integration: `ANTHROPIC_API_KEY`, optional `ANTHROPIC_LABOR_MODEL` (otherwise `ANTHROPIC_MODEL`, otherwise the same default as equipment analysis). Secrets remain server-side. Only selected equipment facts, selected add-ons, scope and template text are sent; internal costs and customer contacts are omitted. The authenticated endpoint requires quotes permission, validates input, limits requests to five per user per minute with one in flight, and has a 45-second provider timeout. Missing configuration/provider failures preserve current text and offer editable templates.

AI output is a draft: staff must check equipment, inclusions and exclusions before applying. No live provider call was made during automated testing. TypeScript, all 155 tests and production build passed, including deletion of linked/paid records, late Stripe settlement and duplicate webhook handling, replacement-invoice guards, AI authorization/input/rate limits and missing-key fallback. Signed-in UI and live provider verification remain owner checks.
