import {db,result,type Row} from "./core";
import {context,stopReason,deliver} from "./delivery";
import {customerSmsReadiness} from "./sms-compose";
const conflict=(message:string)=>Object.assign(new Error(message),{status:409});
export async function sendNowPreview(company:string,id:string,recipient:string) {
  const message=await result(db().from("communications").select("*").eq("company_id",company).eq("id",id).maybeSingle());
  if(!message) throw Object.assign(new Error("Message unavailable."),{status:404});
  if(message.channel!=="sms" || message.category!=="transactional" || message.campaign_id || message.recipient!==recipient)
    throw conflict("Only this confirmed transactional SMS is eligible.");
  if(message.send_now_requested_at) return {message,already_requested:true};
  if(message.status!=="pending" || message.attempts!==0 || message.provider_id) throw conflict("Only an unattempted queued message is eligible. Refresh its status; do not create a copy.");
  const ctx=await context(message), readiness=await customerSmsReadiness(company,message.customer_id);
  if(!readiness.ready || !readiness.sending_enabled) throw conflict(readiness.issues.join(" ") || "CRM sending is paused.");
  if(readiness.recipient!==recipient) throw conflict("The primary phone changed. Review the original customer record.");
  const stop=await stopReason(message,ctx);if(stop) throw conflict(stop);
  return {message,already_requested:false};
}
export async function requestSmsSendNow(company:string,id:string,actor:string,recipient:string,dispatch:typeof deliver=deliver) {
  const preview=await sendNowPreview(company,id,recipient);
  if(preview.already_requested) return preview.message;
  const request=await result(db().rpc("crm_request_sms_send_now",{p_company:company,p_id:id,p_actor:actor,p_recipient:recipient}));
  if(!request.already_requested) await dispatch(request.message);
  return await result(db().from("communications").select("*").eq("company_id",company).eq("id",id).single());
}
export function sendNowView(message:Row) {
  return {id:message.id,customer_id:message.customer_id,quote_id:message.quote_id,invoice_id:message.invoice_id,recipient:message.recipient,body:message.body,status:message.status,provider_status:message.provider_status,error:message.error,scheduled_at:message.scheduled_at,requested_at:message.send_now_requested_at || null};
}
