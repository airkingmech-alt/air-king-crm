import type {Express,Request,Response} from "express";
import {z} from "zod";
import {caller,db,result,phone} from "./core";
import {queueCustomerSms} from "./sms-compose";

const cursor = z.object({at:z.string().datetime({offset:true}),key:z.string().min(1).max(100)}).strict();
function before(value:unknown) {
  if(value === undefined) return null;
  if(typeof value !== "string" || value.length>400) throw Object.assign(new Error("Invalid history cursor."),{status:400});
  return cursor.parse(JSON.parse(value));
}
const wrap = (fn:(req:Request,res:Response)=>Promise<void>) => async(req:Request,res:Response)=>{
  res.set("Cache-Control","no-store");
  try {await fn(req,res);} catch(e:any) {
    res.status(e.status || (e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 503))
      .json({error:e.status ? e.message : e instanceof z.ZodError || e instanceof SyntaxError ? "Invalid conversation request." : "Text messages unavailable. Please retry."});
  }
};
export function registerTextMessages(app:Express) {
  app.get("/api/crm/text-messages",wrap(async(req,res)=>{
    const c=await caller(req), b=before(req.query.before);
    const rows=await result(db().rpc("crm_text_conversations",{p_company:c.company,p_before_at:b?.at || null,p_before_phone:b?.key || ""}));
    const items=rows.slice(0,30), last=items.at(-1);
    res.json({items,next:rows.length>30 ? {at:last.last_at,key:last.phone} : null});
  }));
  app.get("/api/crm/text-messages/history",wrap(async(req,res)=>{
    const c=await caller(req), recipient=z.string().min(1).max(100).parse(req.query.phone), b=before(req.query.before);
    const [rows,customers]=await Promise.all([
      result(db().rpc("crm_text_history",{p_company:c.company,p_phone:recipient,p_before_at:b?.at || null,p_before_key:b?.key || ""})),
      result(db().rpc("crm_text_matches",{p_company:c.company,p_phone:recipient})),
    ]);
    const items=rows.slice(0,50), last=items.at(-1);
    res.json({items,customers,next:rows.length>50 ? {at:last.created_at,key:last.key} : null});
  }));
  app.post("/api/crm/text-messages/send",wrap(async(req,res)=>{
    const c=await caller(req);
    const input=z.object({customer_id:z.string().min(1).max(100),recipient:z.string().regex(/^\+[1-9]\d{7,14}$/),
      body:z.string().trim().min(1).max(1600).refine(v=>!v.includes("{{"))}).strict().parse(req.body);
    const key=z.string().uuid().parse(req.headers["idempotency-key"]);
    const matches=await result(db().rpc("crm_text_matches",{p_company:c.company,p_phone:phone(input.recipient)}));
    if(matches.length!==1 || matches[0].id!==input.customer_id || !matches[0].is_primary)
      throw Object.assign(new Error("This phone does not have one matching primary customer contact. Review the customer records before replying."),{status:409});
    // Reuse consent, suppression, recipient pinning, template, idempotency and outbox checks.
    // No provider calls on this request; unknown outcomes keep the same request key.
    try {res.json({message:await queueCustomerSms(c.company,input.customer_id,c.id,key,input.body,input.recipient)});}
    catch(e:any) {if(e.status) throw e; throw Object.assign(new Error("Queue confirmation unavailable. Retry the same request to confirm its status."),{status:503});}
  }));
}
