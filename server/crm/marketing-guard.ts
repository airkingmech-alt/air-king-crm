import { db, entity, result, shouldStop, type Row } from "./core";
import { destination, matchesAudience, match, valueFor } from "./marketing-rules";

// Separate from the campaign router so delivery never imports its own queue module.
export async function marketingStopReason(msg: Row, customer: Row): Promise<string|null> {
  const run = await entity("marketing_campaign_runs",msg.campaign_run_id,msg.company_id);
  if (["stopped","failed"].includes(run.status)) return "Campaign run was stopped.";
  const snapshot=run.snapshot;
  const step=snapshot?.steps?.find((s:Row)=>s.id===msg.template_snapshot?.campaign_step_id);
  if (!step || !snapshot.audience) return "Campaign send snapshot is missing.";
  try {
    if (destination(customer,msg.channel)!==(msg.channel==="email"?msg.recipient.toLowerCase():msg.recipient)) return "Customer contact changed since launch.";
  } catch { return "Customer contact is no longer valid."; }
  const tables=["quotes","invoices","work_orders","memberships"];
  const data=await Promise.all(tables.map(table=>result(db().from(table).select("*").eq("company_id",msg.company_id).eq("customer_id",customer.id))));
  const related={quotes:data[0],invoices:data[1],jobs:data[2],memberships:data[3]};
  if (!matchesAudience(customer,related,snapshot.audience)) return "Customer no longer matches the campaign audience.";
  if (!(step.conditions||[]).every((c:Row)=>match(valueFor(c.field,customer,related),c))) return "Campaign step conditions no longer match.";
  if (msg.quote_id) {
    const quote=related.quotes.find((q:Row)=>q.id===msg.quote_id);
    if (!quote || shouldStop("quote",quote.data)) return "Quote has closed; follow-up stopped.";
  }
  return null;
}
