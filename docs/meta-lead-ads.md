# Meta Lead Ads connection

The CRM receives Facebook and Instagram instant-form leads at:

`https://air-king-crm.onrender.com/api/webhooks/meta/leadgen`

Render secrets required:

- `META_VERIFY_TOKEN`: random webhook verification value shared with Meta.
- `META_APP_SECRET`: Meta app secret. Never expose it in browser code.
- `META_PAGE_ACCESS_TOKEN`: long-lived Page access token with permission to retrieve leads.

In Meta for Developers, add the Webhooks product, choose Page, enter the callback above and the same verification token, then subscribe to `leadgen`. Connect the Air King Facebook Page to the app and grant the Page/app access to lead retrieval. Test with Meta's Lead Ads Testing Tool. A successful test creates one CRM lead with source `meta`; repeating the same lead ID does not create another row.

The webhook verifies `X-Hub-Signature-256` using `META_APP_SECRET` before processing. It then retrieves the lead through Graph API using the Page access token. CRM storage includes customer-submitted fields plus Page, form, ad, ad set, campaign, and created-time identifiers when Meta supplies them. It never stores the Page access token or app secret in Supabase or the browser.
