import type { Express, Request, Response } from "express";
import { z } from "zod";
import { caller, db, entity, event, result, settings, type Row } from "./core";
import { context, queueMessage } from "./delivery";
import { smsConfigured } from "./readiness";
import { MARKETING_RELEASE_READY, requireMarketingRelease } from "./marketing-readiness";
import { conditionSchema, contacts, destination, matchesAudience, match, valueFor } from "./marketing-rules";

const audienceSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(""),
  mode: z.enum(["static", "dynamic"]).default("dynamic"),
  filters: z.array(conditionSchema).max(30).default([]),
  exclusions: z.array(conditionSchema).max(30).default([]),
  active: z.boolean().default(true),
  archived: z.boolean().default(false),
});
const campaignSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).default(""),
  goal: z.enum([
    "maintenance", "sale", "unsold_estimate", "inactive_customer",
    "equipment_replacement", "membership", "referral", "custom",
  ]).default("custom"),
  campaign_type: z.enum(["one_time", "scheduled", "recurring", "sequence"]).default("one_time"),
  audience_id: z.string().uuid(),
  channels: z.array(z.enum(["email", "sms"])).min(1).max(2),
  starts_at: z.iso.datetime().nullable().optional(),
  recurrence: z.object({ every_days: z.number().int().min(7).max(365).default(30) }).default({every_days:30}),
  settings: z.object({
    frequency_days: z.number().int().min(1).max(365).default(7),
    max_contacts: z.number().int().min(1).max(20).default(2),
    large_send_threshold: z.number().int().min(1).max(10000).default(250),
    stop_on_booking: z.boolean().default(true),
  }).default({ frequency_days: 7, max_contacts: 2, large_send_threshold: 250, stop_on_booking: true }),
  steps: z.array(z.object({
    action: z.enum(["email", "sms", "wait", "activity"]),
    template_id: z.string().uuid().nullable().optional(),
    delay_minutes: z.number().int().min(0).max(525600).default(0),
    conditions: z.array(conditionSchema).max(20).default([]),
    subject: z.string().max(300).optional(),
    body: z.string().trim().min(1).max(10000).optional(),
  })).min(1).max(20),
});

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (e: any) {
      res.status(e.status || 400).json({
        error: e instanceof z.ZodError ? "Please check the campaign fields." : String(e.message || "Unable to complete this request.").slice(0, 300),
      });
    }
  };

async function companyRows(table: string, company: string) {
  const rows: Row[] = [];
  for (let from=0;;from+=500) {
    const page: Row[] = await result(db().from(table).select("*").eq("company_id", company).order(table === "customer_communication_preferences" ? "customer_id" : "id").range(from, from+499));
    rows.push(...page); if (page.length < 500) return rows;
  }
}
export async function evaluateAudience(company: string, audience: Row, channels: string[] = ["email","sms"]) {
  const [customers, quotes, invoices, jobs, memberships, preferences, recent] = await Promise.all([
    companyRows("customers", company), companyRows("quotes", company), companyRows("invoices", company),
    companyRows("work_orders", company), companyRows("memberships", company),
    companyRows("customer_communication_preferences", company),
    result(db().from("communications").select("customer_id,channel,created_at").eq("company_id", company).eq("category","marketing").gte("created_at", new Date(Date.now()-365*86400000).toISOString())),
  ]);
  const byCustomer = (rows: Row[]) => rows.reduce((m: Record<string,Row[]>,x:Row)=>((m[x.customer_id] ||= []).push(x),m),{});
  const grouped = { quotes:byCustomer(quotes), invoices:byCustomer(invoices), jobs:byCustomer(jobs), memberships:byCustomer(memberships) };
  const prefMap = Object.fromEntries(preferences.map((x:Row)=>[x.customer_id,x]));
  const seen = new Set<string>();
  return customers.map(customer => {
    const related = { quotes:grouped.quotes[customer.id]||[], invoices:grouped.invoices[customer.id]||[], jobs:grouped.jobs[customer.id]||[], memberships:grouped.memberships[customer.id]||[] };
    const included = (audience.filters || []).every((c:Row)=>match(valueFor(c.field,customer,related),c));
    const explicitlyExcluded = (audience.exclusions || []).some((c:Row)=>match(valueFor(c.field,customer,related),c));
    const prefs = prefMap[customer.id] || {};
    const contact = contacts(customer);
    const eligibility: Record<string,string|null> = {};
    for (const channel of channels) {
      if (!included) eligibility[channel] = "Does not match audience filters";
      else if (explicitlyExcluded) eligibility[channel] = "Matches an audience exclusion";
      else if (channel === "email" && !contact.email) eligibility[channel] = "Missing email address";
      else if (channel === "email" && (prefs.email_suppressed || prefs.email_marketing !== true)) eligibility[channel] = "Email marketing permission is missing or suppressed";
      else if (channel === "sms" && !contact.phone) eligibility[channel] = "Missing mobile number";
      else if (channel === "sms" && (prefs.sms_stopped || prefs.sms_marketing !== true)) eligibility[channel] = "Marketing text consent is missing or stopped";
      else eligibility[channel] = null;
      if (!eligibility[channel]) {
        try {
          const target = destination(customer, channel);
          if (seen.has(`${channel}:${target}`)) eligibility[channel] = "Duplicate destination in this audience";
          else { seen.add(`${channel}:${target}`); contact[channel === "email" ? "email" : "phone"] = target; }
        } catch { eligibility[channel] = channel === "email" ? "Invalid email address" : "Invalid mobile number"; }
      }
    }
    const latestQuote = [...related.quotes].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
    return { customer_id:customer.id, name:customer.data?.name || "Customer", contact, eligibility, quote_id:latestQuote?.id || null,
      recent_marketing_count: recent.filter((x:Row)=>x.customer_id===customer.id).length };
  });
}

async function saveCampaign(company: string, actor: string, body: unknown, id?: string) {
  const input = campaignSchema.parse(body);
  if (!input.steps.some(s => ["email","sms"].includes(s.action))) throw new Error("Add at least one message step.");
  if (input.campaign_type === "scheduled" && (!input.starts_at || Date.parse(input.starts_at) <= Date.now())) throw new Error("Choose a future send date.");
  await entity("marketing_audiences", input.audience_id, company);
  const steps: Row[] = [];
  for (const step of input.steps) if (["email","sms"].includes(step.action)) {
    if (!input.channels.includes(step.action as "email"|"sms")) throw new Error("Every message step must use a selected channel.");
    if (!step.template_id) throw new Error("Choose a template for every email or text step.");
    const template = await entity("message_templates", step.template_id, company);
    const t = await template;
    if (t.channel !== step.action || t.category !== "marketing" || t.archived || !t.active)
      throw new Error("Campaign steps require an active marketing template for the selected channel.");
    steps.push({...step,content_snapshot:{id:t.id,category:"marketing",channel:t.channel,subject:step.subject??t.subject,body:step.body??t.body}});
  } else steps.push({...step,content_snapshot:{}});
  const record = { company_id:company, audience_id:input.audience_id, name:input.name, description:input.description,
    goal:input.goal, campaign_type:input.campaign_type, channels:Array.from(new Set(input.channels)), starts_at:input.starts_at || null,
    recurrence:input.recurrence, settings:input.settings, enabled:false, status:"draft", created_by:actor, updated_at:new Date().toISOString() };
  return result(db().rpc("crm_save_campaign",{p_company:company,p_actor:actor,p_id:id||null,p_record:record,p_steps:steps}));
}

async function launchReadiness(company: string, campaign: Row) {
  const config = await settings(company);
  if (!config.sending_enabled) throw new Error("Turn on customer communications in Integrations first.");
  if (!process.env.COMMUNICATION_SIGNING_SECRET) throw new Error("Configure secure unsubscribe links first.");
  if (!process.env.MARKETING_POSTAL_ADDRESS?.trim()) throw new Error("Configure Air King's mailing address before sending marketing email.");
  if (campaign.channels.includes("email") && (!process.env.RESEND_API_KEY || !config.sender_email)) throw new Error("Complete Resend and sender email setup first.");
  if (campaign.channels.includes("sms") && !smsConfigured()) throw new Error("Finish Twilio setup before sending texts.");
}

async function campaignPreview(company: string, campaign: Row) {
  const audience = await entity("marketing_audiences",campaign.audience_id,company);
  if (!audience.active || audience.archived) throw new Error("Choose an active audience.");
  const steps: Row[] = await result(db().from("marketing_campaign_steps").select("*").eq("company_id",company).eq("campaign_id",campaign.id).order("sort_order"));
  const people = await evaluateAudience(company,audience,campaign.channels);
  const eligible = people.filter(p => campaign.channels.some((channel:string) => p.eligibility[channel]===null));
  return {audience,steps,people,eligible_count:eligible.length,revision:campaign.revision};
}

export function registerMarketing(app: Express) {
  app.get("/api/crm/marketing", wrap(async (req,res)=>{
    const c=await caller(req); const [campaigns,audiences,messages,attributions]=await Promise.all([
      result(db().from("marketing_campaigns").select("*").eq("company_id",c.company).neq("status","archived").order("updated_at",{ascending:false})),
      result(db().from("marketing_audiences").select("*").eq("company_id",c.company).eq("archived",false).order("updated_at",{ascending:false})),
      result(db().from("communications").select("campaign_id,status,channel,provider_status").eq("company_id",c.company).not("campaign_id","is",null)),
      result(db().from("marketing_attributions").select("campaign_id,value_cents,revenue_status").eq("company_id",c.company)),
    ]);
    res.json({release_ready:MARKETING_RELEASE_READY,campaigns,audiences,summary:{active:campaigns.filter((x:Row)=>x.enabled).length,sent:messages.filter((x:Row)=>["sent","delivered"].includes(x.status)).length,delivered:messages.filter((x:Row)=>x.status==="delivered"||x.provider_status==="delivered").length,
      failed:messages.filter((x:Row)=>x.status==="failed").length, completed_revenue_cents:attributions.filter((x:Row)=>x.revenue_status==="completed").reduce((n:number,x:Row)=>n+Number(x.value_cents),0)}});
  }));
  app.get("/api/crm/marketing/campaigns/:id", wrap(async(req,res)=>{
    const c=await caller(req); const campaign=await entity("marketing_campaigns",String(req.params.id),c.company);
    const [steps,runs,messages]=await Promise.all([
      result(db().from("marketing_campaign_steps").select("*").eq("company_id",c.company).eq("campaign_id",campaign.id).order("sort_order")),
      result(db().from("marketing_campaign_runs").select("*").eq("company_id",c.company).eq("campaign_id",campaign.id).order("created_at",{ascending:false})),
      result(db().from("communications").select("*").eq("company_id",c.company).eq("campaign_id",campaign.id).order("created_at",{ascending:false}).limit(500)),
    ]); res.json({campaign,steps,runs,messages});
  }));
  app.post("/api/crm/marketing/audiences/preview",wrap(async(req,res)=>{
    const c=await caller(req); const input=audienceSchema.parse(req.body); const channels=z.array(z.enum(["email","sms"])).min(1).max(2).parse(req.body.channels || ["email","sms"]); const rows=await evaluateAudience(c.company,input,channels);
    res.json({total:rows.length,rows,eligible_email:rows.filter(x=>x.eligibility.email===null).length,eligible_sms:rows.filter(x=>x.eligibility.sms===null).length});
  }));
  const saveAudience=wrap(async(req,res)=>{
    const c=await caller(req,true); const input=audienceSchema.parse(req.body); let row;
    if(req.params.id){await entity("marketing_audiences",String(req.params.id),c.company);row=await result(db().from("marketing_audiences").update({...input,updated_at:new Date().toISOString()}).eq("id",req.params.id).eq("company_id",c.company).select().single());}
    else row=await result(db().from("marketing_audiences").insert({...input,company_id:c.company,created_by:c.id}).select().single());
    const preview=await evaluateAudience(c.company,row); await result(db().from("marketing_audiences").update({estimated_count:preview.filter(x=>!x.eligibility.email||!x.eligibility.sms).length,evaluated_at:new Date().toISOString()}).eq("id",row.id));
    res.json({message:"Audience saved",audience:row});
  });
  app.post("/api/crm/marketing/audiences",saveAudience); app.put("/api/crm/marketing/audiences/:id",saveAudience);
  app.post("/api/crm/marketing/campaigns",wrap(async(req,res)=>{const c=await caller(req,true);res.json({message:"Campaign saved as a draft",campaign:await saveCampaign(c.company,c.id,req.body)});}));
  app.post("/api/crm/marketing/campaigns/:id/preview",wrap(async(req,res)=>{
    const c=await caller(req,true), campaign=await entity("marketing_campaigns",String(req.params.id),c.company);
    res.json(await campaignPreview(c.company,campaign));
  }));
  app.put("/api/crm/marketing/campaigns/:id",wrap(async(req,res)=>{const c=await caller(req,true);res.json({message:"Campaign updated",campaign:await saveCampaign(c.company,c.id,req.body,String(req.params.id))});}));
  app.post("/api/crm/marketing/campaigns/:id/launch",wrap(async(req,res)=>{
    const c=await caller(req,true); requireMarketingRelease(); const campaign=await entity("marketing_campaigns",String(req.params.id),c.company);
    await launchReadiness(c.company,campaign);
    const confirmation=z.object({revision:z.number().int(),confirm_count:z.number().int(),confirm_name:z.string()}).parse(req.body);
    const snapshot=await campaignPreview(c.company,campaign);
    if (!snapshot.eligible_count) throw new Error("No customers currently qualify for this campaign.");
    if (snapshot.people.length>10000) throw new Error("Narrow this audience to 10,000 customers or fewer.");
    if (confirmation.revision!==campaign.revision || confirmation.confirm_count!==snapshot.eligible_count || confirmation.confirm_name!==campaign.name) throw new Error("Audience or campaign changed. Preview it again before confirming.");
    const scheduledAt=campaign.starts_at || new Date().toISOString();
    const key=z.string().uuid().parse(req.headers["idempotency-key"]);
    const run=await result(db().rpc("crm_launch_campaign",{p_company:c.company,p_id:campaign.id,p_key:key,p_revision:campaign.revision,p_snapshot:snapshot}));
    await event({company_id:c.company,campaign_id:campaign.id,campaign_run_id:run.id,actor_id:c.id},"campaign.launched",{scheduled_at:scheduledAt},`campaign-launch:${run.id}`);
    res.json({message:Date.parse(scheduledAt)>Date.now()?"Campaign scheduled":"Campaign queued",run});
  }));
  app.post("/api/crm/marketing/campaigns/:id/toggle",wrap(async(req,res)=>{
    const c=await caller(req,true); const campaign=await entity("marketing_campaigns",String(req.params.id),c.company); const enabled=z.boolean().parse(req.body.enabled);
    if (enabled) {requireMarketingRelease();await launchReadiness(c.company,campaign);}
    await result(db().rpc("crm_control_campaign",{p_company:c.company,p_id:campaign.id,p_action:enabled?"resume":"pause"}));
    await event({company_id:c.company,campaign_id:campaign.id,actor_id:c.id},enabled?"campaign.resumed":"campaign.paused");
    res.json({message:enabled?"Campaign resumed":"Campaign paused"});
  }));
  app.post("/api/crm/marketing/campaigns/:id/control",wrap(async(req,res)=>{
    const c=await caller(req,true); const action=z.enum(["stop","archive"]).parse(req.body.action);
    await result(db().rpc("crm_control_campaign",{p_company:c.company,p_id:String(req.params.id),p_action:action}));
    await event({company_id:c.company,campaign_id:String(req.params.id),actor_id:c.id},`campaign.${action}`);
    res.json({message:action==="stop"?"Campaign stopped":"Campaign archived"});
  }));
}

export async function processMarketingRuns() {
  if (!MARKETING_RELEASE_READY) return {runs:0};
  const claimed: Row[]=await result(db().rpc("crm_claim_marketing_runs"));
  for(const run of claimed) {
    try {
      const campaign=await entity("marketing_campaigns",run.campaign_id,run.company_id);
      let snapshot=run.snapshot;
      if (!snapshot.people) {
        snapshot={...snapshot,people:await evaluateAudience(run.company_id,snapshot.audience,campaign.channels)};
        await result(db().from("marketing_campaign_runs").update({snapshot}).eq("id",run.id).eq("claim_token",run.claim_token));
      }
      const steps:Row[]=snapshot.steps, preview:Row[]=snapshot.people;
      if (!steps?.length) throw new Error("Campaign snapshot is missing. Nothing was sent.");
      let offset=0, queued=0, remaining=false;
      for (const step of steps) {
        offset += Number(step.delay_minutes||0);
        if (step.action === "activity") {
          if (Date.now() >= Date.parse(run.scheduled_at)+offset*60000) await event({company_id:run.company_id,campaign_id:campaign.id,campaign_run_id:run.id},"campaign.activity",{step:step.sort_order},`campaign-activity:${run.id}:${step.id}`);
          else remaining=true;
          continue;
        }
        if (!["email","sms"].includes(step.action)) continue;
        for (const person of preview) {
          if (queued>=50) { remaining=true; break; }
          const existing:Row|null=await result(db().from("marketing_campaign_recipients").select("*").eq("run_id",run.id).eq("customer_id",person.customer_id).eq("step_id",step.id).eq("channel",step.action).maybeSingle());
          if(existing?.communication_id || existing?.eligibility==="excluded") continue;
          const current=await entity("marketing_campaigns",campaign.id,run.company_id);
          if (!current.enabled || current.status==="paused" || current.status==="stopped") {remaining=true;break;}
          const reason=person.eligibility[step.action];
          await result(db().from("marketing_campaign_recipients").upsert({company_id:run.company_id,run_id:run.id,campaign_id:campaign.id,step_id:step.id,customer_id:person.customer_id,channel:step.action,recipient:step.action==="email"?person.contact.email:person.contact.phone,eligibility:reason?"excluded":"eligible",exclusion_reason:reason},{onConflict:"run_id,customer_id,step_id,channel",ignoreDuplicates:true}));
          queued++;
          if (reason) continue;
          const scheduledAt=new Date(Date.parse(run.scheduled_at)+offset*60000).toISOString();
          const msg=await queueMessage({company_id:run.company_id,customer_id:person.customer_id,campaign_id:campaign.id,campaign_run_id:run.id,campaign_step_id:step.id,quote_id:campaign.goal==="unsold_estimate"?person.quote_id:null,scheduled_at:scheduledAt,expected_recipient:step.action==="email"?person.contact.email:person.contact.phone},step.action,step.content_snapshot,`campaign:${run.id}:${step.id}:${person.customer_id}:${step.action}`,`campaign:${campaign.name}`);
          await result(db().from("marketing_campaign_recipients").update({eligibility:msg.status==="failed"?"failed":"queued",communication_id:msg.id,updated_at:new Date().toISOString()}).eq("run_id",run.id).eq("customer_id",person.customer_id).eq("step_id",step.id).eq("channel",step.action));
        }
      }
      await result(db().rpc("crm_finish_campaign_tick",{p_id:run.id,p_token:run.claim_token,p_remaining:remaining}));
    } catch(e:any) { await result(db().from("marketing_campaign_runs").update({status:"failed",error:String(e.message).slice(0,300),lease_until:null,updated_at:new Date().toISOString()}).eq("id",run.id).eq("claim_token",run.claim_token)); }
  }
  return {runs:claimed.length};
}
