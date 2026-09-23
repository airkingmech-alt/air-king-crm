import type Stripe from "stripe";

export const DIRECT_API_VERSION = "2026-08-26.preview";
export function directCheckoutReady(company: string, env = process.env) {
  return env.STRIPE_DIRECT_CHECKOUT_COMPANY_ID === company &&
    /^pk_(live|test)_/.test(env.STRIPE_PUBLISHABLE_KEY || "") &&
    !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET &&
    (env.STRIPE_PUBLISHABLE_KEY!.startsWith("pk_live_") === /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY!));
}
export function invoiceFeeBps(invoice: Record<string, any>, config: Record<string, any>) {
  // Never charge a second fee on invoices created with the earlier manual line item.
  if (invoice.items?.some((i: any) => /^Credit-card fee \(/.test(i.description))) return 0;
  if (!config.fee_enabled) return 0;
  const percent = invoice.cardFeePercent ?? Number(config.fee_basis_points || 0) / 100;
  if (!Number.isFinite(percent) || percent < 0 || percent > 3) throw new Error("Invalid invoice card fee.");
  return Math.round(percent * 100);
}
export function calculateCardFee(base: number, bps: number, method: any) {
  if (!Number.isSafeInteger(base) || base < 50 || !Number.isInteger(bps) || bps < 0 || bps > 300)
    throw new Error("Invalid payment amount or fee.");
  // Unknown funding and all non-card payment methods are fee-free.
  return method?.type === "card" && method.card?.funding === "credit"
    ? Math.round(base * bps / 10000) : 0;
}
export function nativeIntentParams(a: Record<string, any>): Stripe.PaymentIntentCreateParams {
  return {
    amount: Number(a.amount_cents) + Number(a.fee_cents), currency: "usd",
    description: `Air King invoice ${a.invoice_id}`,
    metadata: { attempt_id: a.id, invoice_id: a.invoice_id, checkout_kind: "direct" },
    ...(Number(a.fee_cents) > 0 ? {
      amount_details: { surcharge: { amount: Number(a.fee_cents), enforce_validation: "enabled" } },
    } : {}),
  } as Stripe.PaymentIntentCreateParams;
}
export function verifyDirectPayment(intent: Stripe.PaymentIntent, a: Record<string, any>, live: boolean) {
  const base = Number(a.amount_cents), fee = Number(a.fee_cents);
  const surcharge = (intent as any).amount_details?.surcharge;
  const charge = intent.latest_charge as Stripe.Charge | null;
  if (a.checkout_kind !== "direct" || intent.id !== a.payment_intent_id ||
      intent.metadata?.attempt_id !== a.id || intent.metadata?.checkout_kind !== "direct" ||
      intent.metadata?.invoice_id !== a.invoice_id || intent.status !== "succeeded" ||
      intent.currency !== "usd" || intent.livemode !== live ||
      !Number.isSafeInteger(base) || base < 50 || !Number.isSafeInteger(fee) || fee < 0 ||
      fee > Math.round(base * 300 / 10000) || intent.amount !== base + fee || intent.amount_received !== base + fee ||
      (fee > 0 && (surcharge?.amount !== fee || surcharge.status !== "available" ||
        surcharge.enforce_validation !== "enabled" || !Number.isSafeInteger(surcharge.maximum_amount) ||
        fee > surcharge.maximum_amount || charge?.payment_method_details?.type !== "card" ||
        charge.payment_method_details.card?.funding !== "credit"))) {
    throw new Error("Payment verification mismatch.");
  }
  return fee;
}
