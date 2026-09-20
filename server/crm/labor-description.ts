import type { Express } from "express";
import { z } from "zod";
import { caller } from "./core";
import { laborInputSchema, laborSystemPrompt, laborTemplates, type LaborInput } from "../../shared/labor-descriptions";
export async function generateLaborDescription(input:LaborInput):Promise<string> {
 if(!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI drafting is not connected yet. You can use a labor template and edit it now. Ask the owner to add OPENAI_API_KEY in Render."),{status:503});
 const safe=laborInputSchema.parse(input);
 try {
  const response=await fetch("https://api.openai.com/v1/responses",{
   method:"POST",redirect:"error",signal:AbortSignal.timeout(45000),
   headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
   body:JSON.stringify({model:process.env.OPENAI_LABOR_MODEL || "gpt-4.1-mini-2025-04-14",store:false,max_output_tokens:1600,
    instructions:laborSystemPrompt,input:JSON.stringify({equipment:safe.equipment,selectedAddOns:safe.addOns,scope:safe.scope,startingTemplate:laborTemplates.find(t=>t.id===safe.templateId)?.body || null})}),
  });
  if(!response.ok) {
   if(response.status===401 || response.status===403) throw Object.assign(new Error("OpenAI could not authorize this request. Ask the owner to check the API key and model access in Render. Your description has not changed."),{providerSetup:true});
   if(response.status===429) throw Object.assign(new Error("OpenAI's usage limit was reached. Try again shortly, or ask the owner to check API billing and limits. Your description has not changed."),{providerSetup:true});
   throw new Error("OpenAI request failed");
  }
  const data=await response.json();
  if(data.status!=="completed" || !Array.isArray(data.output)) throw new Error("Incomplete draft");
  const content=data.output.filter((item:any)=>item.type==='message' && item.role==='assistant').flatMap((item:any)=>Array.isArray(item.content)?item.content:[]);
  if(content.some((item:any)=>item.type==='refusal')) throw new Error("Draft unavailable");
  const text=content.filter((item:any)=>item.type==='output_text' && typeof item.text==='string').map((item:any)=>item.text).join('\n').trim();
  if(text.length<20 || text.length>8000) throw new Error('Incomplete draft');
  return text;
 }catch(e:any){throw Object.assign(new Error(e.providerSetup ? e.message : "OpenAI drafting is temporarily unavailable. Your current description has not changed. Try again or use a labor template."),{status:503});}
}
export function registerLaborDescription(app:Express,generate=generateLaborDescription) {
 console.info("Labor description AI (OpenAI): " + (process.env.OPENAI_API_KEY ? "configured" : "not configured; templates available"));
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
