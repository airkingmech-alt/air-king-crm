import {useEffect,useRef,useState} from "react";
import {crm} from "@/lib/crm-api";
import {Button} from "@/components/ui/button";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
export function SmsSendNow({id,recipient,onUpdated}:{id:string;recipient:string;onUpdated:()=>void}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[preview,setPreview]=useState<any>(null),[notice,setNotice]=useState("");
  const lock=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const path=`crm/text-messages/${id}/send-now`;
  return <div className="mt-2"><Button size="sm" variant="outline" disabled={busy} onClick={async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setNotice("");
    try {const value=await crm(path+"?"+new URLSearchParams({recipient}));if(mounted.current){setPreview(value);setOpen(true);}}
    catch(e:any){if(mounted.current)setNotice(e.message);}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }}>Send now…</Button>
  {notice&&<p role="status" className="text-xs mt-1">{notice}</p>}
  <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Send this queued text now?</DialogTitle><DialogDescription>Authorize one attempt outside the company’s quiet hours. Consent and opt-out checks still apply. No new text is created.</DialogDescription></DialogHeader>
    {preview&&<><p className="text-sm">To: <strong>{preview.message.recipient}</strong></p><p className="text-xs break-all">{preview.message.quote_id ? `Quote: ${preview.message.quote_id}` : `Customer: ${preview.message.customer_id}`} · Message: {id}</p><p className="whitespace-pre-wrap text-sm break-words">{preview.message.body}</p>
    {preview.already_requested?<p>This message already has a Send now request. Current status: {preview.message.status}. Check delivery status before any further action.</p>:<Button data-testid="confirm-sms-send-now" disabled={busy} onClick={async()=>{
      if(lock.current)return;lock.current=true;setBusy(true);
      try {const value=await crm(path,"POST",{recipient,confirmed:true});if(mounted.current){setOpen(false);setNotice(`Request recorded. Status: ${value.message.status}${value.message.status==="sent"?" — delivery not yet confirmed":""}.`);onUpdated();}}
      catch(e:any){if(mounted.current){setOpen(false);setNotice(`Confirmation unavailable: ${e.message}. Check this message’s status; retrying this same action cannot create another text.`);onUpdated();}}
      finally{lock.current=false;if(mounted.current)setBusy(false);}
    }}>{busy?"Checking and submitting…":"Confirm one-time Send now"}</Button>}
    <Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button></>}
  </DialogContent></Dialog></div>;
}
