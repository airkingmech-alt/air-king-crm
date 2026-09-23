import Stripe from "stripe";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db, result, entity, publicDocument, settings, origin, type Row } from "./core";
import { calculateCardFee, directCheckoutReady, invoiceFeeBps, nativeIntentParams, verifyDirectPayment, DIRECT_API_VERSION } from "./card-fee";

const client = () => new Stripe(process.env.STRIPE_SECRET_KEY!,{httpClient:Stripe.createFetchHttpClient()});
const opts = { apiVersion: DIRECT_API_VERSION };
const requestSchema = z.object({confirmationToken: z.string().regex(/^ctoken_[a-zA-Z0-9]+$/)});
const confirmSchema = requestSchema.extend({amount: z.number().int().min(50),fee: z.number().int().min(0), confirmed: z.literal(true)});

async function invoiceFor(token: string) {
  const {kind, row} = await publicDocument(token);
  if (kind !== "invoice") throw new Error("Only invoices can be paid.");
  const config = await settings(row.company_id);
  if (!config.payments_enabled || !directCheckoutReady(row.company_id)) throw new Error("Online checkout is unavailable. Please contact Air King.");
  return {row, config};
}
async function activeAttempt(row: Row) {
  return result(db().from("checkout_attempts").select("*").eq("invoice_id",row.id).eq("company_id",row.company_id)
    .eq("checkout_kind","direct").in("state",["reserved","open"]).order("created_at",{ascending:false}).limit(1).maybeSingle());
}
async function ensureIntent(a: Row) {
  if (a.payment_intent_id) return client().paymentIntents.retrieve(a.payment_intent_id,{expand:["latest_charge"]},opts);
  // Creating is separate from confirming so recovery/cancellation can NEVER charge.
  let intent: Stripe.PaymentIntent;
  try {
    intent = await client().paymentIntents.create(nativeIntentParams(a),{...opts,idempotencyKey:`direct-create:${a.id}`});
  } catch(e: any) {
    // A definitive validation error means no intent was created. Network errors are
    // ambiguous: retain the reservation and recover with the same idempotency key.
    if(e.type === "StripeInvalidRequestError") await result(db().from("checkout_attempts").update({state:"failed"}).eq("id",a.id).is("payment_intent_id",null));
    throw e;
  }
  await result(db().from("checkout_attempts").update({payment_intent_id:intent.id}).eq("id",a.id));
  a.payment_intent_id = intent.id;
  return client().paymentIntents.retrieve(intent.id,{expand:["latest_charge"]},opts);
}
export async function settleDirectPayment(a: Row, eventId?: string, eventType="payment_intent.succeeded") {
  const intent = await ensureIntent(a);
  if(intent.status !== "succeeded") return intent;
  const fee = verifyDirectPayment(intent,a,/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || ""));
  const charge = intent.latest_charge as Stripe.Charge;
  const card = charge?.payment_method_details?.card;
  await result(db().rpc("crm_record_surcharge_payment",{
    p_invoice:a.invoice_id,p_company:a.company_id,p_amount:a.amount_cents,p_fee:fee,
    p_method:card ? `${card.brand} •••• ${card.last4}` : charge?.payment_method_details?.type || "Online",
    p_external:intent.id,p_attempt:a.id,p_event:eventId || `reconcile:${intent.id}`,p_event_type:eventType,
    p_receipt:charge?.receipt_url || null,
  }));
  return intent;
}
async function cancelAttempt(a: Row) {
  let intent = await ensureIntent(a);
  if(intent.status === "succeeded") return settleDirectPayment(a);
  if(intent.status !== "canceled") {
    try { intent = await client().paymentIntents.cancel(intent.id,{},opts); }
    catch(e) {
      intent = await ensureIntent(a);
      if(intent.status === "succeeded") return settleDirectPayment(a);
      if(intent.status !== "canceled") throw e;
    }
  }
  await result(db().from("checkout_attempts").update({state:"cancelled"}).eq("id",a.id).neq("state","paid"));
  return intent;
}
export async function reconcileDirectPayments(invoiceId?: string) {
  if(!process.env.STRIPE_SECRET_KEY) return;
  let query = db().from("checkout_attempts").select("*").eq("checkout_kind","direct").in("state",["reserved","open"]);
  if(invoiceId) query=query.eq("invoice_id",invoiceId);
  const rows: Row[] = await result(query.order("created_at").limit(20));
  for(const a of rows) {
    const intent=await ensureIntent(a);
    if(intent.status === "succeeded") await settleDirectPayment(a);
    else if(intent.status === "canceled") await cancelAttempt(a);
    else if(intent.status !== "processing" && Date.now()-Date.parse(a.created_at)>3600000) await cancelAttempt(a);
  }
}
function response(a: Row, intent: Stripe.PaymentIntent) {
  return {attemptId:a.id,status:intent.status,amount:Number(a.amount_cents),fee:Number(a.fee_cents),
    // Never expose an unconfirmed intent secret. Confirmation stays on the server.
    clientSecret:intent.status === "requires_action" ? intent.client_secret : undefined};
}
async function review(row: Row, config: Row, token: string) {
  if(row.data.deletedAt || ["Void","Draft","Paid"].includes(row.data.status)) throw new Error("Invoice is not payable.");
  const ct=await client().confirmationTokens.retrieve(token);
  const live=/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || "");
  if(ct.livemode !== live || ct.payment_intent || ct.setup_intent || !ct.expires_at || ct.expires_at*1000<=Date.now()) throw new Error("Payment details expired. Please enter them again.");
  const paid: Row[]=await result(db().from("payments").select("amount_cents").eq("invoice_id",row.id));
  const amount=Math.round(Number(row.data.amount)*100)-paid.reduce((sum,p)=>sum+Number(p.amount_cents),0);
  const fee=calculateCardFee(amount,invoiceFeeBps(row.data,config),ct.payment_method_preview);
  const card=ct.payment_method_preview?.card;
  return {amount,fee,total:amount+fee,method:card ? `${card.brand} ending ${card.last4}` : ct.payment_method_preview?.type || "Online payment"};
}
export function registerCardCheckout(app: Express, wrap: (fn: (req:Request,res:Response)=>Promise<any>)=>any) {
  app.post("/api/public/documents/:token/payment-review",wrap(async(req,res)=>{
    const {row,config}=await invoiceFor(String(req.params.token));
    const body=requestSchema.parse(req.body);
    res.json(await review(row,config,body.confirmationToken));
  }));
  app.post("/api/public/documents/:token/payment-confirm",wrap(async(req,res)=>{
    const {row,config}=await invoiceFor(String(req.params.token));
    const body=confirmSchema.parse(req.body);
    let a=await result(db().from("checkout_attempts").select("*").eq("confirmation_token",body.confirmationToken).maybeSingle());
    if(a) {
      if(a.invoice_id!==row.id || a.company_id!==row.company_id || Number(a.amount_cents)!==body.amount || Number(a.fee_cents)!==body.fee) throw new Error("Payment reference mismatch.");
    } else {
      const current=await review(row,config,body.confirmationToken);
      if(current.amount!==body.amount || current.fee!==body.fee) throw new Error("The amount changed. Review your payment again.");
      a=await result(db().rpc("crm_reserve_direct_payment",{p_invoice:row.id,p_company:row.company_id,p_amount:current.amount,p_fee:current.fee,p_token:body.confirmationToken}));
    }
    if(!["reserved","open","paid"].includes(a.state)) throw new Error("This payment was cancelled. Enter your payment details again.");
    let intent=await ensureIntent(a);
    if(["requires_payment_method","requires_confirmation"].includes(intent.status)) {
      // Freeze the reviewed method and amount; Stripe independently rejects debit
      // surcharges and fees exceeding its technical cap before authorizing funds.
      intent=await client().paymentIntents.confirm(intent.id,{
        confirmation_token:a.confirmation_token,return_url:`${origin()}/#/customer/${req.params.token}?payment=processing`,
        use_stripe_sdk:true,
      },{...opts,idempotencyKey:`direct-confirm:${a.id}`});
    }
    if(intent.status==="succeeded") intent=await settleDirectPayment(a);
    else if(intent.status!=="canceled") await result(db().from("checkout_attempts").update({state:"open"}).eq("id",a.id).eq("state","reserved"));
    res.json(response(a,intent));
  }));
  app.get("/api/public/documents/:token/payment-status",wrap(async(req,res)=>{
    const {row}=await invoiceFor(String(req.params.token));
    await reconcileDirectPayments(row.id);
    const a=await activeAttempt(row);
    res.json(a ? response(a,await ensureIntent(a)) : {status:"none"});
  }));
  app.post("/api/public/documents/:token/payment-cancel",wrap(async(req,res)=>{
    const {row}=await invoiceFor(String(req.params.token));
    const id=z.string().uuid().parse(req.body.attemptId);
    const a=await entity("checkout_attempts",id,row.company_id);
    if(a.invoice_id!==row.id || a.checkout_kind!=="direct") throw new Error("Payment reference mismatch.");
    res.json(response(a,await cancelAttempt(a)));
  }));
}
