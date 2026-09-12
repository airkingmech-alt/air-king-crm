// Marketing has its own kill switch, separate from transactional quotes,
// invoices, receipts, and the company-wide communication setting.
export const MARKETING_RELEASE_READY = process.env.MARKETING_SENDING_ENABLED === "true";

export function requireMarketingRelease() {
  if (!MARKETING_RELEASE_READY)
    throw new Error("Marketing sending is locked. Finish the launch checklist, then enable Marketing Sending in Render.");
}
