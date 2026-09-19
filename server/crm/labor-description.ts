import type { Express } from "express";
import { z } from "zod";
import { caller } from "./core";
import { laborInputSchema, laborSystemPrompt, laborTemplates, type LaborInput } from "../../shared/labor-descriptions";
export async function generateLaborDescription(input:LaborInput):Promise<string> {
 if(!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("AI drafting is not connected yet. You can use a labor template and edit it now. The owner can connect AI with the server's ANTHROPIC_API_KEY setting."),{status:503});
 const Anthropic=(await import("@anthropic-ai/sdk")).default;
 const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:1,timeout:45000});
 try {
  const response=await client.messages.create({model:process.env.ANTHROPIC_LABOR_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",max_tokens:1600,system:laborSystemPrompt,
   messages:[{role:"user",content:JSON.stringify({equipment:input.equipment,selectedAddOns:input.addOns,scope:input.scope,startingTemplate:laborTemplates.find(t=>t.id===input.templateId)?.body || null})}]});
  const text=response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();
  if(response.stop_reason!=='end_turn' || text.length<20 || text.length>8000) throw new Error('Incomplete draft');
  return text;
 }catch {throw Object.assign(new Error("AI drafting is temporarily unavailable. Your current description has not changed. Try again or use a labor template."),{status:503});}
}
export function registerLaborDescription(app:Express,generate=generateLaborDescription) {
 console.info("Labor description AI: " + (process.env.ANTHROPIC_API_KEY ? "configured" : "not configured; templates available"));
 const active=new Set<string>(),recent=new Map<string,number[]>();
 app.post('/api/crm/quotes/labor-description',async(req,res)=>{
  res.set('Cache-Control','no-store');let key:string|undefined;
  try {
   const user=await caller(req);
   const input=laborInputSchema.parse(req.body);
   const now=Date.now();
   for(const [id,times] of Array.from(recent))if(times.every(t=>now-t>=60000))recent.delete(id);
   const times=(recent.get(user.id)||[]).filter(t=>now-t<60000);
   if(active.has(user.id)||times.length>=5)throw Object.assign(new Error('Please wait a moment before generating another draft.'),{status:429});
   key=user.id;active.add(key);recent.set(key,[...times,now]);
   const description=await generate(input);
   res.json({description});
  }catch(e:any){res.status(e.status||400).json({error:e instanceof z.ZodError?'Select equipment and enter your scope of work (up to 5,000 characters).':e.message});}
  finally{if(key)active.delete(key);}
 });
}
