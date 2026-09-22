# Sent.dm SMS connection

Air King's Sent.dm account is registered for customer care. The adapter pins `channel: ["sms"]`, blocks marketing, and retains existing consent and quiet-hour checks. WhatsApp is not connected.

Render runtime settings: `SMS_PROVIDER=sentdm`, `SENT_DM_API_KEY`, `SENT_DM_ACCOUNT_ID`, `SENT_DM_COMPANY_ID`, `SENT_DM_WEBHOOK_SECRET`, and `SENT_DM_WEBHOOK_ID`. Store credentials only in Render. The webhook URL is `/api/webhooks/sentdm`; subscribe to message events. Signed requests require the exact account, endpoint, raw body, and a timestamp within five minutes. Incoming STOP messages suppress matching customers within the configured company. Replies are recorded in communication history; START does not automatically restore consent.

Sending remains disabled with `SENT_DM_SENDING_ENABLED=false`. Before activation:

1. Verify US brand/campaign approval and assigned SMS sender in Sent.dm.
2. Complete SMS-only onboarding. The dashboard currently blocks template creation until onboarding is complete; do not connect WhatsApp to work around this.
3. Create and obtain approval for a customer-care SMS template with a named `message` text parameter, e.g. `Air King Mechanical Services service update: {{message}}`. Set its ID as `SENT_DM_TEMPLATE_ID`.
4. Set `SENT_DM_SENDING_ENABLED=true`, redeploy, and obtain authorization for a test to a confirmed consenting recipient. Verify actual delivery and incoming reply/STOP history before general use.

The API requires a template for first contact. Do not replace this with unrestricted free text. Provider response IDs are namespaced `sentdm:`; retries retain the CRM message's idempotency key. Ambiguous acceptance remains unknown for reconciliation.

References: https://docs.sent.dm/start/guides/sending-messages and https://docs.sent.dm/start/webhooks/signature-verification.
