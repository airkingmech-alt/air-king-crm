import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { crm } from "@/lib/crm-api";
import type { Customer } from "@/data/mock-data";
const labels: Record<string,string> = {brand:"Manufacturer",model:"Model",serial:"Serial",capacity:"Capacity / tonnage (with units)",manufactureYear:"Manufacture year (approximate if inferred)",efficiency:"Efficiency (rating and units)",refrigerant:"Refrigerant",notes:"Notes"};
const fieldMap:Record<string,string>={brand:"manufacturer",manufactureYear:"manufactureYear"};
export function EquipmentScanner({customer}:{customer:Customer}) {
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [notice,setNotice]=useState("");
  const [image,setImage]=useState(""), [draft,setDraft]=useState<any>(null), [form,setForm]=useState<any>({});
  const [propertyId,setPropertyId]=useState(customer.properties[0]?.id || "");
  const [systemId,setSystemId]=useState(""); const [confirmed,setConfirmed]=useState(false);
  async function analyze(file?:File) {
    if(!file)return;
    setBusy(true);setNotice("");setDraft(null);setConfirmed(false);setImage("");
    try {
      if(!["image/jpeg","image/png","image/webp","image/gif"].includes(file.type) || file.size>5_000_000) throw new Error("Choose a JPG, PNG, WebP, or GIF under 5 MB.");
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Could not read the photo."));reader.readAsDataURL(file);});
      setImage(data);
      const result=await crm("equipment/analyze","POST",{customerId:customer.id,image:data,fileName:file.name});
      setDraft(result);const fields=result.analysis.fields;
      setForm({brand:fields.manufacturer.value || "",model:fields.model.value || "",serial:fields.serial.value || "",type:fields.equipmentType.value || "",capacity:fields.capacity.value || "",manufactureYear:fields.manufactureYear.value || "",efficiency:fields.efficiency.value || "",refrigerant:fields.refrigerant.value || "",notes:result.analysis.note});
      window.dispatchEvent(new Event("crm-refresh"));
    } catch(e:any){setNotice(e.message);} finally{setBusy(false);}
  }
  async function save() {
    setBusy(true);setNotice("");
    try{
      await crm("equipment/confirm","POST",{customerId:customer.id,propertyId,photoId:draft.photoId,systemId:systemId || undefined,confirmed,equipment:{...form,manufactureYear:form.manufactureYear===""?null:Number(form.manufactureYear)}});
      setNotice("Equipment saved to the customer profile.");setDraft(null);setImage("");setConfirmed(false);window.dispatchEvent(new Event("crm-refresh"));
    }catch(e:any){setNotice(e.message);}finally{setBusy(false);}
  }
  return <><Button variant="outline" onClick={()=>setOpen(true)}>Scan Equipment Nameplate</Button>
    <Dialog open={open} onOpenChange={v=>!busy&&setOpen(v)}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Equipment nameplate</DialogTitle><DialogDescription>Photograph the label straight on in good light. AI readings are suggestions; review every field before saving. Photos are processed by our AI provider.</DialogDescription></DialogHeader>
      <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Take a photo<Input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={e=>analyze(e.target.files?.[0])}/></label><label className="text-sm">Upload a photo<Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={e=>analyze(e.target.files?.[0])}/></label></div>
      {busy&&<p role="status">{draft?"Saving confirmed equipment…":"Reading nameplate…"}</p>}{notice&&<p role="status" className="rounded border p-3 text-sm">{notice}</p>}
      {image&&<img src={image} alt="Equipment nameplate to review" className="max-h-60 mx-auto object-contain"/>}
      {draft&&<><div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">Property<select className="block w-full rounded border p-2 bg-background" value={propertyId} onChange={e=>{setPropertyId(e.target.value);setSystemId("");setConfirmed(false);}}><option value="">Choose property</option>{customer.properties.map(p=><option key={p.id} value={p.id}>{p.address}</option>)}</select></label>
        <label className="text-sm">Save as<select className="block w-full rounded border p-2 bg-background" value={systemId} onChange={e=>{setSystemId(e.target.value);setConfirmed(false);}}><option value="">New equipment</option>{customer.properties.find(p=>p.id===propertyId)?.systems.map(s=><option key={s.id} value={s.id}>Update {s.brand} {s.type} {s.model}</option>)}</select></label>
        <label className="text-sm">Equipment type<select className="block w-full rounded border p-2 bg-background" value={form.type} onChange={e=>{setForm({...form,type:e.target.value});setConfirmed(false);}}><option value="">Choose type</option>{["AC","Coil","Furnace","Air Handler","Heat Pump","Mini-Split","Package Unit"].map(t=><option key={t}>{t}</option>)}</select><span className="text-xs text-muted-foreground">{draft.analysis.fields.equipmentType.confidence} confidence · {draft.analysis.fields.equipmentType.evidence}</span></label>
        {Object.entries(labels).map(([key,label])=>{const reading=draft.analysis.fields[fieldMap[key]||key];return <label key={key} className="text-sm">{label}<Input value={form[key]} onChange={e=>{setForm({...form,[key]:e.target.value});setConfirmed(false);}}/>{reading&&<span className="text-xs text-muted-foreground">{reading.confidence} confidence · {reading.evidence}</span>}</label>;})}
      </div><p className="text-xs text-muted-foreground">Leave unknown values blank. If updating equipment, the reviewed fields above replace those fields; installation date, warranty, and other existing details are retained.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the photo and corrected these details. Save them to this customer's equipment record.</label>
      <Button disabled={busy||!confirmed||!propertyId||!form.type} onClick={save}>Confirm & Save Equipment</Button></>}
    </DialogContent></Dialog>
  </>;
}
