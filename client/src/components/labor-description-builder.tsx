import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { laborTemplates, templateDraft, type LaborInput } from "@shared/labor-descriptions";
import { crm } from "@/lib/crm-api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function LaborDescriptionBuilder({equipment,addOns,scope,onScopeChange,onApply}: {
 equipment:LaborInput['equipment']; addOns:LaborInput['addOns']; scope:string;
 onScopeChange:(text:string)=>void; onApply:(text:string)=>void;
}) {
 const [templateId,setTemplateId]=useState<LaborInput['templateId']>('custom');
 const [draft,setDraft]=useState(''),[draftSource,setDraftSource]=useState('');
 const [draftInputs,setDraftInputs]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[applied,setApplied]=useState(false);
 // Send only equipment facts; never prices, internal costs, or customer contact information.
 const input:LaborInput={equipment:equipment.map(({brand,model,category,description})=>({brand,model,category,description})),addOns:addOns.map(({name,description})=>({name,description})),scope,templateId};
 const fingerprint=JSON.stringify(input);
 const current=useRef(fingerprint);current.current=fingerprint;
 const generate=async()=>{
  if(busy)return;setBusy(true);setError('');setApplied(false);
  const snapshot=fingerprint;
  try {const result=await crm('crm/quotes/labor-description','POST',input);
   if(current.current!==snapshot){setError('Equipment or scope changed while drafting. Generate a new draft for the updated selection.');return;}
   setDraft(result.description);setDraftInputs(snapshot);setDraftSource('AI draft — review before using');
  }catch(e:any){setError(e.message);}finally{setBusy(false);}
 };
 const stale=!!draft && draftInputs!==fingerprint;
 return <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
  <div><p className="font-semibold text-sm flex items-center gap-2"><Sparkles size={16}/>Labor description helper</p>
   <p className="text-xs text-muted-foreground mt-1">Uses your selected equipment and scope notes. Review the draft, edit it, then apply it to your quote.</p></div>
  <Label className="block">Starting description
   <select value={templateId} disabled={busy} onChange={e=>setTemplateId(e.target.value as LaborInput['templateId'])} className="mt-1 w-full rounded-md border bg-background p-2 text-sm">
    <option value="custom">Custom scope only</option>{laborTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
   </select>
  </Label>
  <p className="text-xs text-muted-foreground">Selected equipment: {equipment.length ? equipment.map(e=>e.model || e.description).join(', ') : 'Select equipment before using AI.'}</p>
  <Label className="block">Scope of work / special instructions
   <Textarea value={scope} maxLength={5000} disabled={busy} onChange={e=>onScopeChange(e.target.value)} rows={4} className="mt-1 font-normal" placeholder="Example: Replace the outdoor AC, coil and furnace. Reuse the existing line set and thermostat. Include removal and startup. No duct modifications. Equipment is in the basement."/>
  </Label>
  <div className="flex flex-wrap gap-2">
   <Button type="button" size="sm" disabled={busy || !equipment.length || scope.trim().length<5} onClick={generate}><Sparkles size={14} className="mr-1.5"/>{busy?'Writing draft…':'Generate with AI'}</Button>
   <Button type="button" size="sm" variant="outline" disabled={busy || templateId==='custom'} onClick={()=>{
    setDraft(templateDraft(templateId,input.equipment,scope));setDraftInputs(fingerprint);setDraftSource('Template draft — review before using');setError('');setApplied(false);
   }}>Use template</Button>
  </div>
  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  {draft && <div className="space-y-2">
   <Label className="block">{draftSource}<Textarea value={draft} maxLength={8000} onChange={e=>{setDraft(e.target.value);setApplied(false);}} rows={9} className="mt-1 font-normal"/></Label>
   {stale && <p role="alert" className="text-sm text-amber-700">Equipment, add-ons, or scope changed. Generate a fresh draft before applying.</p>}
   <Button type="button" size="sm" disabled={busy||stale||!draft.trim()} onClick={()=>{onApply(draft.trim());setApplied(true);}}>Use this labor description</Button>
   {applied && <p role="status" className="text-sm text-emerald-700">Applied to the quote. You can still edit the labor description before saving.</p>}
  </div>}
 </div>;
}
