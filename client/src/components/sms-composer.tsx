import {useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/context/auth-context";
import {crm} from "@/lib/crm-api";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";

type Submission = {key:string; body:string; recipient:string};
export function SmsComposer({customerId, onQueued}: {customerId:string; onQueued:()=>void}) {
  const {profile} = useAuth();
  const storageKey = `sms-submission:${profile?.company_id}:${profile?.id}:${customerId}`;
  const [submission, setSubmission] = useState<Submission | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { return null; }
  });
  const [body, setBody] = useState(submission?.body || "");
  const [busy,setBusy] = useState(false);
  const lock = useRef(false);
  const [notice,setNotice] = useState(submission ? "A prior request needs confirmation. Retry confirmation uses the same request and cannot queue a second text." : "");
  const {data,error,refetch} = useQuery({queryKey:["customer-sms",profile?.company_id,customerId],
    queryFn:()=>crm(`crm/customers/${customerId}/sms`),refetchInterval:15000});
  const remember = (value:Submission | null) => {
    // Store an in-flight request before submitting so navigation/reload cannot
    // generate a fresh key after an ambiguous network response.
    if (value) sessionStorage.setItem(storageKey,JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    setSubmission(value);
  };
  return <section className="rounded-lg border p-3 space-y-2" aria-label="Send customer SMS">
    <h3 className="font-semibold">Text customer</h3>
    <p className="text-sm">SMS to primary contact: {submission?.recipient || data?.recipient || "Not available"}</p>
    <p className="text-xs text-muted-foreground">Customer-care messages only. Confirm the recipient above when replying. Reply STOP instructions are added automatically.</p>
    {data?.mode === "approved_template" && <p className="text-xs text-muted-foreground">Sent uses your approved customer-care template. First-contact and onboarding requirements still apply.</p>}
    {data && <p className="text-xs text-muted-foreground">Texts wait outside {data.sms_start}:00–{data.sms_end}:00 ({data.timezone}). {!data.sending_enabled && "CRM sending is paused; queued texts will wait."}</p>}
    {data?.issues?.map((issue:string)=><p key={issue} className="text-sm text-amber-700">{issue}</p>)}
    {error && <p role="alert" className="text-sm">{error.message}</p>}
    <Label htmlFor={`sms-body-${customerId}`}>SMS message</Label>
    <Textarea id={`sms-body-${customerId}`} value={body} maxLength={1600} disabled={busy || !!submission}
      onChange={event=>setBody(event.target.value)} placeholder="Write a service or appointment message" />
    <Button disabled={busy || (!submission && (!data?.ready || !body.trim()))} onClick={async()=>{
      if(lock.current) return;
      lock.current=true;setBusy(true);
      try {
        const attempt = submission || {key:crypto.randomUUID(),body:body.trim(),recipient:data.recipient};
        remember(attempt);
        const result = await crm(`crm/customers/${customerId}/sms`,"POST",{body:attempt.body,recipient:attempt.recipient},attempt.key);
        const message=result.message;
        remember(null);setBody("");
        setNotice(message.status === "pending" ? "Text queued, not delivered. Follow its status in the customer timeline."
          : message.status === "failed" || message.status === "cancelled" ? `Text ${message.status}: ${message.error || "Review the timeline."}`
          : "Request already recorded. Check the customer timeline; do not resend an uncertain delivery.");
        onQueued();await refetch();
      } catch(error:any) {
        // A definite validation/auth rejection cannot have queued this request.
        // Network/5xx/409 remain locked to the same key for safe confirmation.
        if ([400,401,403,404].includes(error.status)) remember(null);
        setNotice(error.message + (error.status ? "" : " Retry confirmation before composing another text."));
      } finally {lock.current=false;setBusy(false);}
    }}>{busy ? "Submitting…" : submission ? "Retry confirmation" : "Queue SMS"}</Button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
