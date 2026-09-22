import type Stripe from "stripe";

// Checkout automatic surcharge is a Stripe preview. The provider enforces eligibility
// and the agreed <=3% rate BEFORE charging; reconciliation is defense in depth.
export const SURCHARGE_API_VERSION = "2026-08-26.preview";
export const SURCHARGE_CAP_BPS = 300;
export function surchargeReady(company: string, env = process.env, now = Date.now()) {
  const readyAt = Date.parse(env.STRIPE_SURCHARGE_READY_AT || "");
  return env.STRIPE_SURCHARGE_COMPANY_ID === company &&
    Number.isFinite(readyAt) && readyAt <= now &&
    !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET;
}
export function surchargeEnabled(company: string, config: Record<string, any>) {
  return config.fee_enabled === true && config.fee_basis_points === SURCHARGE_CAP_BPS &&
    config.fee_fixed_cents === 0 && surchargeReady(company);
}
export function surchargeCheckoutOptions(enabled: boolean) {
  return enabled ? {
    automatic_surcharge: { enabled: true, calculation_basis: "total_after_tax" as const },
    adaptive_pricing: { enabled: false },
    billing_address_collection: "auto" as const,
    custom_text: { submit: { message: "Eligible credit cards: a merchant surcharge of up to 3% applies. Debit and prepaid cards have no surcharge. Review the fee and total before paying." } },
  } : {};
}
export type SurchargeSession = Stripe.Checkout.Session & {
  automatic_surcharge?: { enabled?: boolean; status?: string } | null;
  surcharge_cost?: { amount_subtotal: number; amount_tax: number; amount_total: number } | null;
};
export function verifiedSurcharge(
  session: SurchargeSession,
  intent: Stripe.PaymentIntent,
  attempt: { id: string; session_id?: string | null; amount_cents: number | string; surcharge_basis_points?: number | null },
  live: boolean,
) {
  const base = Number(attempt.amount_cents);
  const total = session.amount_total;
  const fee = total == null ? NaN : total - base;
  const cap = attempt.surcharge_basis_points || 0;
  if (session.metadata?.attempt_id !== attempt.id ||
      (attempt.session_id && session.id !== attempt.session_id) ||
      session.mode !== "payment" || session.currency !== "usd" || session.livemode !== live ||
      session.payment_status !== "paid" || intent.currency !== "usd" || intent.livemode !== live ||
      intent.status !== "succeeded" || intent.amount_received !== total ||
      intent.metadata?.attempt_id !== attempt.id ||
      (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) !== intent.id ||
      !Number.isSafeInteger(base) || base < 50 || !Number.isSafeInteger(fee) || fee < 0 ||
      ![0, SURCHARGE_CAP_BPS].includes(cap) || fee > Math.round(base * cap / 10000)) {
    throw new Error("Payment verification mismatch.");
  }
  if (cap > 0) {
    if (!session.automatic_surcharge?.enabled || session.amount_subtotal !== base ||
        session.metadata?.surcharge_cap_bps !== String(cap)) {
      throw new Error("Surcharge configuration mismatch.");
    }
    const cost = session.surcharge_cost;
    if (cost && (cost.amount_total !== fee || cost.amount_tax !== 0 || cost.amount_subtotal !== fee)) {
      throw new Error("Surcharge breakdown mismatch.");
    }
    if (fee > 0) {
      const charge = intent.latest_charge as Stripe.Charge | null;
      if (session.automatic_surcharge.status !== "complete" || !cost ||
          charge?.payment_method_details?.type !== "card" ||
          charge.payment_method_details.card?.funding !== "credit") {
        throw new Error("Only verified credit-card surcharges can be recorded.");
      }
    }
  }
  return fee;
}
