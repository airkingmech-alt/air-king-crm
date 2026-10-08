import type { Express, Request, Response } from "express";
import { z } from "zod";
import { crownEnrollmentSnapshot, crownTierSnapshot } from "../../shared/crown-tiers";
import { loadCrownCatalog } from "./crown-catalog";
import { caller,db,result,entity,hash } from "./core";
import { crownAgreement,crownConfiguration,configurationFor,renewalFrom,type CrownConfiguration } from "../../shared/crown-care";
import { checklistSchema, completionErrors, templates } from "../../shared/crown-checklists";
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  res.set("Cache-Control","no-store");
  try{await fn(req,res);}catch(e:any){res.status(e.status || 400).json({error:e instanceof z.ZodError?e.issues[0]?.message || "Check the membership fields.":e.message,...(e.code?{code:e.code}:{})});}
};
async function access(req:Request){
  const user=await caller(req);
  const profile=await result(db().from("profiles").select("permissions").eq("id",user.id).single());
  if(user.role!=="owner" && profile.permissions?.memberships===false)throw fail("Crown Care access is disabled. Ask the owner.",403);
  return user;
}
function validatedConfiguration(configuration:CrownConfiguration,customer:any){
  const properties=customer.data.properties || [];
  for(const equipment of configuration.coveredEquipment){
    const property=properties.find((p:any)=>p.id===equipment.propertyId);
    if(equipment.propertyId&&!property)throw fail("Choose a property belonging to this customer.");
    if(equipment.systemId && (!property || !property.systems?.some((s:any)=>s.id===equipment.systemId)))throw fail("The selected equipment does not belong to this customer property.");
    if(equipment.systemId && equipment.quantity!==1)throw fail("Saved equipment is one unit. Add additional units separately.");
  }
  return {...configuration,draftTier:configuration.draftTier?crownTierSnapshot(configuration.draftTier):null,pricing:{...configuration.pricing,totalAmountCents:configuration.pricing.baseAmountCents+configuration.pricing.adjustmentCents,currency:"usd"},
    systemDescription:configuration.coveredEquipment.map(e=>`${e.quantity} × ${e.type}${e.description?" — "+e.description:""}`).join("; "),
    systemId:configuration.coveredEquipment[0].systemId || "",
    propertyAddress:Array.from(new Set(configuration.coveredEquipment.map(e=>properties.find((p:any)=>p.id===e.propertyId)).filter(Boolean).map((p:any)=>[p.address,p.city,p.state,p.zip].filter(Boolean).join(", ")))).join("; ")};
}
export function registerCrownCare(app:Express){
  app.post("/api/crm/memberships/:id/checklists",wrap(async(req,res)=>{
    const user=await access(req),input=z.object({version:z.string().min(1),checklist:checklistSchema}).strict().parse(req.body);
    const row=await entity("memberships",String(req.params.id),user.company),c=input.checklist;
    const reports=row.data.checklists || [],prior=reports.find((r:any)=>r.id===c.id);
    const requestHash=hash(JSON.stringify(c));
    if(prior?.requestHash===requestHash)return res.json({membership:row.data,version:row.updated_at});
    if(prior?.status==="completed")throw fail("Completed reports are preserved. Create a new checklist for corrections.",409);
    if(row.updated_at!==input.version)throw fail("This membership changed. Close and reopen checklists to load the latest version.",409);
    const equipment=(row.data.coveredEquipment || []).find((e:any)=>e.id===c.equipmentId);
    if(!equipment || c.unit>equipment.quantity)throw fail("Choose a covered equipment unit. Update membership coverage first.");
    if(prior&&(prior.equipmentId!==c.equipmentId||prior.unit!==c.unit||prior.kind!==c.kind))throw fail("A saved checklist cannot change equipment or template.");
    const t=templates[c.kind];
    if(Object.keys(c.answers).some(k=>!t.tasks[Number(k)]||String(Number(k))!==k)||Object.keys(c.readings).some(k=>!t.readings.includes(k)))throw fail("Invalid checklist fields.");
    if(c.status==="completed"){const errors=completionErrors(c);if(errors.length)throw fail(errors[0]);}
    if(!prior&&reports.length>=500)throw fail("This membership has reached its report limit. Contact the administrator to archive it.");
    const at=new Date().toISOString();
    const report={...c,templateVersion:1,requestHash,createdAt:prior?.createdAt||at,updatedAt:at,savedBy:user.id,completedAt:c.status==="completed"?at:null,equipmentSnapshot:prior?.equipmentSnapshot||equipment};
    const data={...row.data,checklists:[...reports.filter((r:any)=>r.id!==c.id),report]};
    const saved=await result(db().from("memberships").update({data}).eq("id",row.id).eq("company_id",user.company).eq("updated_at",input.version).select("data,updated_at").maybeSingle());
    if(!saved)throw fail("Another employee saved changes. Reopen the membership before saving.",409);
    res.json({membership:saved.data,version:saved.updated_at});
  }));
  app.get("/api/crm/memberships/:id",wrap(async(req,res)=>{
    const user=await access(req),row=await entity("memberships",String(req.params.id),user.company);
    res.json({membership:row.data,version:row.updated_at});
  }));
  app.post("/api/crm/memberships",wrap(async(req,res)=>{
    const user=await access(req),key=z.string().uuid().parse(req.headers["idempotency-key"]);
    const input=z.object({customerId:z.string().min(1),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),autoRenew:z.boolean(),configuration:crownConfiguration,agreement:crownAgreement.optional()}).strict().parse(req.body);
    if(input.configuration.draftTier)throw fail("Historical draft interest cannot enroll a customer. Select a current Crown Care tier.",409);
    const requestHash=hash(JSON.stringify(input)),id="CC-"+key;
    // A retried successful save keeps its original agreed snapshot even if prices changed.
    const existing=await result(db().from("memberships").select("*").eq("id",id).eq("company_id",user.company).maybeSingle());
    if(existing){
      if(existing.data?.deletedAt || existing.data?.requestHash!==requestHash)throw fail("This enrollment was already saved with different details. Refresh before creating another.",409);
      return res.json({membership:existing.data});
    }
    const renewalDate=renewalFrom(input.startDate),customer=await entity("customers",input.customerId,user.company);
    const config=validatedConfiguration(input.configuration,customer);
    let tierPlan;
    if(input.configuration.enrollmentTier){
      if(!input.agreement)throw fail("Confirm the customer accepted this plan and record the acceptance date before enrolling.");
      renewalFrom(input.agreement.acceptedOn);
      if(input.agreement.acceptedOn>new Date().toISOString().slice(0,10))throw fail("Customer acceptance date cannot be in the future.");
      tierPlan=crownEnrollmentSnapshot(input.configuration.enrollmentTier,await loadCrownCatalog(user.company));
      if(config.billingFrequency!=="Annual" || config.visitsIncluded!==2 || config.pricing.baseAmountCents!==tierPlan.annualTotalCents || config.pricing.adjustmentCents!==0)throw fail("Tier enrollment must use the displayed annual price and two included visits. Refresh the catalog and review the selected systems.",409);
    } else if(input.agreement)throw fail("Choose a Crown Care tier before recording tier acceptance.");
    const at=new Date().toISOString();
    const data={...config,id,customerId:customer.id,customerName:customer.data.name,startDate:input.startDate,renewalDate,autoRenew:input.autoRenew,
      ...(tierPlan?{tierPlan,agreement:{...input.agreement,recordedAt:at,recordedBy:user.id,method:"staff_attestation",attestation:"Customer accepted the selected Crown Care tier, covered systems, annual price, and displayed benefits.",planSnapshot:tierPlan}}:{}),
      status:"Active",paymentStatus:"Pending",visitsUsed:0,springVisit:{status:"Unscheduled"},fallVisit:{status:"Unscheduled"},requestHash,
      configurationHistory:[{at,actorId:user.id,requestKey:key,before:null,after:{...config,...(tierPlan?{tierPlan}:{})}}]};
    const saved=await db().from("memberships").insert({id,company_id:user.company,customer_id:customer.id,data}).select("data").single();
    if(saved.error){
      if(saved.error.code!=="23505")throw fail("Could not save the membership. Try again.");
      const prior=await entity("memberships",id,user.company);
      if(prior.data.requestHash!==requestHash)throw fail("This enrollment was already saved with different details. Refresh before creating another.",409);
      return res.json({membership:prior.data});
    }
    res.json({membership:saved.data.data});
  }));
  app.patch("/api/crm/memberships/:id",wrap(async(req,res)=>{
    const user=await access(req),key=z.string().uuid().parse(req.headers["idempotency-key"]);
    const input=z.object({version:z.string().min(1),configuration:crownConfiguration}).strict().parse(req.body);
    const row=await entity("memberships",String(req.params.id),user.company);
    const requestHash=hash(JSON.stringify(input));
    const prior=(row.data.configurationHistory || []).find((h:any)=>h.requestKey===key);
    if(prior){if(prior.requestHash!==requestHash)throw fail("Save reference was reused. Reopen the membership and try again.",409);return res.json({membership:row.data,version:row.updated_at});}
    if(row.updated_at!==input.version)throw fail("Someone changed this membership. Reopen it to review the latest details.",409);
    if(input.configuration.visitsIncluded<Number(row.data.visitsUsed || 0))throw fail("Included visits cannot be fewer than the visits already used.");
    if(row.data.stripeSubscriptionId || row.data.stripe_subscription_id)throw fail("This membership has linked billing. Its pricing must be updated through the billing workflow.",409);
    if(row.data.tierPlan){
      const original=configurationFor(row.data),next=input.configuration;
      if(JSON.stringify(next.enrollmentTier)!==JSON.stringify(original.enrollmentTier) || next.draftTier || next.billingFrequency!==original.billingFrequency || next.visitsIncluded!==original.visitsIncluded || JSON.stringify(next.pricing)!==JSON.stringify(original.pricing))throw fail("This membership keeps its accepted tier, covered-system count, benefits, and price. Catalog changes apply to new enrollments only.",409);
    }else if(input.configuration.enrollmentTier)throw fail("Existing memberships keep their agreed terms. New tier selection belongs in a new enrollment.",409);
    const customer=await entity("customers",row.customer_id,user.company),config=validatedConfiguration(input.configuration,customer);
    if(!config.propertyAddress)config.propertyAddress=row.data.propertyAddress || "";
    const data={...row.data,...config,configurationHistory:[...(row.data.configurationHistory || []),{at:new Date().toISOString(),actorId:user.id,requestKey:key,requestHash,before:{draftTier:row.data.draftTier,coveredEquipment:row.data.coveredEquipment,pricing:row.data.pricing,notes:row.data.notes,billingFrequency:row.data.billingFrequency,visitsIncluded:row.data.visitsIncluded,systemDescription:row.data.systemDescription},after:config}]};
    const saved=await result(db().from("memberships").update({data}).eq("id",row.id).eq("company_id",user.company).eq("updated_at",input.version).select("data,updated_at").maybeSingle());
    if(!saved)throw fail("Someone changed this membership. Reopen it and try again.",409);
    res.json({membership:saved.data,version:saved.updated_at});
  }));
}
