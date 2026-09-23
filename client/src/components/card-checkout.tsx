import { useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { crm } from "@/lib/crm-api";

const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
type Review={amount:number;fee:number;total:number;method:string;confirmationToken:string};
type Pending={attemptId?:string;status:string;clientSecret?:string;amount?:number;fee?:number};
export function CardCheckout({token,publishableKey,amount,onPaid,onClose}:{token:string;publishableKey:string;amount:number;onPaid:()=>void;onClose:()=>void}) {
  const stripePromise=useMemo(()=>loadStripe(publishableKey),[publishableKey]);
  return <Elements stripe={stripePromise} options={{mode:"payment",currency:"usd",amount,paymentMethodCreation:"manual",appearance:{theme:"stripe"}}}>
    <PaymentForm token={token} onPaid={onPaid} onClose={onClose}/>
  </Elements>;
}
function PaymentForm({token,onPaid,onClose}:{token:string;onPaid:()=>void;onClose:()=>void}) {
  const stripe=useStripe(),elements=useElements();
  const [review,setReview]=useState<Review|null>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState("");
  const path=`public/documents/${token}`;
  async function status() {
    const state:Pending=await crm(path+"/payment-status");
    setPending(state.status==="none" ? null : state);
    return state;
  }
  useEffect(()=>{let mounted=true;crm(path+"/payment-status").then((s:Pending)=>{if(mounted)setPending(s.status==="none"?null:s)}).catch(e=>{if(mounted)setNotice(e.message)}).finally(()=>{if(mounted)setLoading(false)});return()=>{mounted=false};},[path]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);setNotice("");
    try{await action()}catch(e:any){setNotice(e.message || "Unable to complete payment. Please try again.");try{await status()}catch{/* Preserve original error and offer retry. */}}
    finally{setBusy(false)}
  }
  async function handleResult(p:Pending) {
    if(p.status==="requires_action" && p.clientSecret && stripe) {
      const r=await stripe.handleNextAction({clientSecret:p.clientSecret});
      if(r.error)throw new Error(r.error.message || "Payment authentication was not completed.");
      p={...p,status:r.paymentIntent?.status || "processing"};
    }
    if(p.status==="succeeded") {setReview(null);setPending(null);setNotice("Payment received. Updating your invoice…");onPaid();onClose();}
    else if(p.status==="processing") {setPending(p);setNotice("Your payment is processing. Please do not submit another payment.");onPaid();}
    else if(p.status==="canceled") {setPending(null);setReview(null);}
    else {setPending(p);setNotice("This payment is incomplete. Resume it or cancel it to choose another method.");}
  }
  async function prepare() {
    if(!stripe || !elements)return;
    const submitted=await elements.submit();
    if(submitted.error)throw new Error(submitted.error.message);
    const r=await stripe.createConfirmationToken({elements});
    if(r.error || !r.confirmationToken)throw new Error(r.error?.message || "Enter your payment details.");
    const summary=await crm(path+"/payment-review","POST",{confirmationToken:r.confirmationToken.id});
    setReview({...summary,confirmationToken:r.confirmationToken.id});
  }
  async function pay() {
    if(!review)return;
    const result:Pending=await crm(path+"/payment-confirm","POST",{confirmationToken:review.confirmationToken,amount:review.amount,fee:review.fee,confirmed:true});
    setPending(result);await handleResult(result);
  }
  async function cancel() {
    if(pending?.attemptId) {
      const r:Pending=await crm(path+"/payment-cancel","POST",{attemptId:pending.attemptId});
      if(r.status==="succeeded"){await handleResult(r);return;}
      if(r.status!=="canceled")throw new Error("This payment is still processing. Please contact Air King before paying another way.");
    }
    setPending(null);setReview(null);setNotice("Payment cancelled. You can choose another method or arrange cash/check with Air King.");
  }
  return <div className="space-y-4 rounded-lg border bg-background p-4">
    <h3 className="font-semibold">Secure payment through Stripe</h3>
    {loading ? <p>Checking payment status…</p> : pending ? <div className="space-y-3">
      <p>A payment is in progress. Complete or cancel it before paying another way.</p>
      {pending.amount!==undefined && <p>Total: <strong>{money(pending.amount+(pending.fee||0))}</strong></p>}
      <Button disabled={busy || !stripe} onClick={()=>run(async()=>{const s=await status();if(s.status==="none"){onPaid();setReview(null);}else if(["requires_payment_method","requires_confirmation"].includes(s.status) && review){await pay();}else await handleResult(s);})}>Resume / check payment</Button>
      <Button variant="outline" className="ml-2" disabled={busy} onClick={()=>run(cancel)}>Cancel payment</Button>
    </div> : <>
      <div className={review ? "hidden" : ""}><PaymentElement options={{layout:"accordion"}}/></div>
      {review ? <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{review.method}</p>
        <dl className="space-y-2"><div className="flex justify-between"><dt>Invoice balance</dt><dd>{money(review.amount)}</dd></div>
          <div className="flex justify-between"><dt>Credit-card fee</dt><dd>{money(review.fee)}</dd></div>
          <div className="flex justify-between border-t pt-2 font-bold"><dt>Total payment</dt><dd>{money(review.total)}</dd></div></dl>
        <p className="text-xs text-muted-foreground">Review this total before paying. You may change payment method or close checkout to arrange cash/check with Air King.</p>
        <Button className="w-full" disabled={busy || !stripe} onClick={()=>run(pay)}>{busy?"Processing…":`PAY ${money(review.total)} IN FULL`}</Button>
        <Button variant="outline" disabled={busy} onClick={()=>setReview(null)}>Change payment method</Button>
      </div> : <Button className="w-full" disabled={busy || !stripe || !elements} onClick={()=>run(prepare)}>{busy?"Checking payment details…":"Review fee and total"}</Button>}
      <Button variant="ghost" disabled={busy} onClick={onClose}>Close / pay cash or check instead</Button>
    </>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
