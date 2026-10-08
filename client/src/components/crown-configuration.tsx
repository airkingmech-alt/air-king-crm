import { crownTierIds, crownEnrollmentSnapshot, type CrownTierId, type CrownCatalog, type CrownEnrollmentSnapshot, type CrownTierSnapshot } from "../../../shared/crown-tiers";
import { selectEnrollmentTier } from "@/lib/crown-enrollment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerRecord as Customer } from "@/data/customer-record";
import { coverageTypes,type CrownConfiguration,type CoveredEquipment } from "../../../shared/crown-care";
const selectClass="block w-full rounded-md border bg-background p-2 text-sm";
export const crownMoney=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
export function CrownConfigurationFields({customer,value,onChange,enrollment=false,catalog,lockedPlan,historicalDraft}:{customer?:Customer;value:CrownConfiguration;onChange:(v:CrownConfiguration)=>void;enrollment?:boolean;catalog?:CrownCatalog;lockedPlan?:CrownEnrollmentSnapshot;historicalDraft?:CrownTierSnapshot | null}){
  const selection=value.enrollmentTier;
  const stale=!!selection&&selection.catalogVersion!==catalog?.version;
  const selectedPlan=selection&&catalog&&!stale&&Number.isInteger(selection.systemCount)&&selection.systemCount>=1&&selection.systemCount<=100?crownEnrollmentSnapshot(selection,catalog):undefined;
  const update=(id:string,patch:Partial<CoveredEquipment>)=>onChange({...value,coveredEquipment:value.coveredEquipment.map(e=>e.id===id?{...e,...patch}:e)});
  function add(system?:any,propertyId=customer?.properties[0]?.id || ""){
    const type=coverageTypes.includes(system?.type)?system.type:"Other";
    onChange({...value,coveredEquipment:[...value.coveredEquipment,{id:crypto.randomUUID(),propertyId,systemId:system?.id,type:system?type:"Furnace",description:system?[system.brand,system.model].filter(Boolean).join(" "):"",quantity:1,filterSize:system?.filterSize || "",filterQuantity:system?.filterSize?1:0,filterNotes:"",notes:""}]});
  }
  return <div className="space-y-5">
    {lockedPlan?<section className="space-y-3 rounded-lg border border-yellow-300 p-3" aria-label="Saved tier agreement">
      <h3 className="font-semibold">{lockedPlan.name} · Saved membership terms</h3>
      <p>{crownMoney(lockedPlan.annualPerSystemCents)} per complete system / year × {lockedPlan.systemCount} {lockedPlan.systemCount===1?"system":"systems"} = <strong>{crownMoney(lockedPlan.annualTotalCents)} / year</strong></p>
      <p className="text-xs text-muted-foreground">Agreed catalog version: {lockedPlan.catalogVersion}. Later catalog prices do not change this membership. Tier, covered system count, price, and included visits are locked.</p>
      <ul className="list-disc pl-5 text-sm space-y-1">{lockedPlan.benefits.map(benefit=><li key={benefit}>{benefit}</li>)}</ul>
      <p className="text-xs">{lockedPlan.filterPolicy}. {lockedPlan.excludedFilterSupply}.</p>
    </section>:enrollment?<section className="space-y-3 rounded-lg border border-yellow-300 p-3" aria-label="Select enrollment tier">
      <h3 className="font-semibold">Choose an annual Crown Care tier</h3>
      <label className="block text-sm">Membership tier<select className={selectClass} required disabled={!catalog} value={selection?.tier || ""} data-testid="select-enrollment-tier" onChange={e=>{if(catalog&&e.target.value)onChange(selectEnrollmentTier(value,catalog,e.target.value as CrownTierId,selection?.systemCount || 1));}}>
        <option value="">{catalog?"Choose Bronze, Silver, or Gold…":"Loading current prices…"}</option>{catalog&&crownTierIds.map(id=><option key={id} value={id}>{catalog.tiers[id].name} · {crownMoney(catalog.tiers[id].annualPerSystemCents)} / complete system / year</option>)}
      </select></label>
      {selection&&<><label className="block text-sm">Covered complete systems<Input type="number" required min={1} max={100} step={1} value={selection.systemCount} data-testid="input-enrollment-system-count" onChange={e=>{if(catalog)onChange(selectEnrollmentTier(value,catalog,selection.tier,Number(e.target.value)));}}/></label>
      <p className="text-xs text-muted-foreground">Count complete covered HVAC systems, not individual components. For example, one furnace and its matching AC count as one complete system. Equipment listed below documents this coverage; adding a component does not increase the system count.</p>
      {stale&&<div role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-950"><p>Prices have changed. Review the current price, then verify customer acceptance again.</p><Button type="button" variant="outline" className="mt-2" disabled={!catalog} onClick={()=>{if(catalog)onChange(selectEnrollmentTier(value,catalog,selection.tier,selection.systemCount));}}>Use latest prices</Button></div>}
      {selectedPlan&&<><p className="font-semibold" data-testid="enrollment-annual-total">{crownMoney(selectedPlan.annualPerSystemCents)} / complete system / year × {selectedPlan.systemCount} = {crownMoney(selectedPlan.annualTotalCents)} / year</p>
      <ul className="list-disc pl-5 text-sm space-y-1">{selectedPlan.benefits.map(benefit=><li key={benefit}>{benefit}</li>)}</ul><p className="text-xs">{selectedPlan.filterPolicy}. {selectedPlan.excludedFilterSupply}.</p><p className="text-xs text-muted-foreground">Price version: {selectedPlan.catalogVersion} · Annual plan · Two visits per year</p></>}
      </>}
    </section>:null}
    {historicalDraft&&<section className="rounded-lg border p-3 text-sm"><h3 className="font-semibold">Historical draft interest: {historicalDraft.name}</h3><p className="text-xs text-muted-foreground">Saved draft version {historicalDraft.catalogVersion}{historicalDraft.systemCount?` · ${historicalDraft.systemCount} complete systems`:""}. This planning record did not activate benefits or set an agreed price.</p></section>}
    <section className="space-y-3"><h3 className="font-semibold">Covered equipment</h3><p className="text-xs text-muted-foreground">Select the customer's saved equipment or add a coverage item. Filter details and notes here belong to this membership.</p>
      {customer&&<label className="block text-sm">Add saved equipment<select className={selectClass} value="" onChange={e=>{if(!e.target.value)return;const [propertyId,systemId]=JSON.parse(e.target.value);const system=customer.properties.find(p=>p.id===propertyId)?.systems.find(s=>s.id===systemId);if(system)add(system,propertyId);}}>
        <option value="">Choose equipment from customer profile…</option>{customer.properties.flatMap(p=>p.systems.filter(s=>!value.coveredEquipment.some(e=>e.systemId===s.id&&e.propertyId===p.id)).map(s=><option key={p.id+":"+s.id} value={JSON.stringify([p.id,s.id])}>{p.address} · {s.brand} {s.type} {s.model}</option>))}
      </select></label>}
      {value.coveredEquipment.map((equipment,index)=><div key={equipment.id} className="rounded-lg border p-3 space-y-3">
        <div className="flex justify-between items-center"><h4 className="font-medium text-sm">Equipment {index+1}{equipment.systemId?" · Linked to profile":""}</h4><Button type="button" size="sm" variant="ghost" onClick={()=>onChange({...value,coveredEquipment:value.coveredEquipment.filter(e=>e.id!==equipment.id)})}>Remove</Button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">Type<select className={selectClass} value={equipment.type} onChange={e=>update(equipment.id,{type:e.target.value as CoveredEquipment["type"]})}>{coverageTypes.map(t=><option key={t}>{t}</option>)}</select></label>
          <label className="text-sm">Property<select className={selectClass} value={equipment.propertyId} disabled={!!equipment.systemId} onChange={e=>update(equipment.id,{propertyId:e.target.value})}><option value="">Use membership address / unspecified</option>{customer?.properties.map(p=><option key={p.id} value={p.id}>{p.address}</option>)}</select></label>
          <label className="text-sm sm:col-span-2">Description / location / model<Input value={equipment.description} maxLength={500} required={equipment.type==="Other"} placeholder="Upstairs mini-split, 3 indoor heads; Champion 3-ton heat pump" onChange={e=>update(equipment.id,{description:e.target.value})}/></label>
          <label className="text-sm">Units covered<Input type="number" min={1} max={100} required disabled={!!equipment.systemId} value={equipment.quantity} onChange={e=>update(equipment.id,{quantity:Number(e.target.value)})}/></label>
          <label className="text-sm">Filter size<Input value={equipment.filterSize} maxLength={100} placeholder="20 × 25 × 4 or washable screen" onChange={e=>update(equipment.id,{filterSize:e.target.value})}/></label>
          <label className="text-sm">Filter quantity<Input type="number" min={0} max={100} required value={equipment.filterQuantity} onChange={e=>update(equipment.id,{filterQuantity:Number(e.target.value)})}/></label>
          <label className="text-sm">Filter instructions<Input value={equipment.filterNotes} maxLength={500} placeholder="MERV 11; customer supplies filter; clean each visit" onChange={e=>update(equipment.id,{filterNotes:e.target.value})}/></label>
          <label className="text-sm sm:col-span-2">Equipment service notes<Textarea value={equipment.notes} maxLength={2000} placeholder="Access instructions, mini-split head locations, additional service needs" onChange={e=>update(equipment.id,{notes:e.target.value})}/></label>
        </div>
      </div>)}
      <Button type="button" variant="outline" onClick={()=>add()} disabled={value.coveredEquipment.length>=100}>Add Equipment / Other Item</Button>
    </section>
    <section className="space-y-3"><h3 className="font-semibold">Membership price & service</h3>
      {!enrollment&&!lockedPlan&&<>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">Price period<select className={selectClass} value={value.billingFrequency} onChange={e=>{const next=e.target.value as "Annual"|"Monthly",factor=next===value.billingFrequency?1:next==="Annual"?12:1/12;onChange({...value,billingFrequency:next,pricing:{...value.pricing,baseAmountCents:Math.round(value.pricing.baseAmountCents*factor),adjustmentCents:Math.round(value.pricing.adjustmentCents*factor)}});}}><option>Annual</option><option>Monthly</option></select></label>
        <label className="text-sm">Visits included per year<Input required type="number" min={1} max={52} value={value.visitsIncluded} onChange={e=>onChange({...value,visitsIncluded:Number(e.target.value)})}/></label>
        <label className="text-sm">Base price ($ per {value.billingFrequency==="Annual"?"year":"month"})<Input key={"base"+value.billingFrequency} type="number" step="0.01" min={0} max={1000000} required defaultValue={(value.pricing.baseAmountCents/100).toFixed(2)} onChange={e=>onChange({...value,pricing:{...value.pricing,baseAmountCents:Math.round(Number(e.target.value)*100)}})}/></label>
        <label className="text-sm">Adjustment ($, use − for discount)<Input key={"adjustment"+value.billingFrequency} type="number" step="0.01" min={-1000000} max={1000000} required defaultValue={(value.pricing.adjustmentCents/100).toFixed(2)} onChange={e=>onChange({...value,pricing:{...value.pricing,adjustmentCents:Math.round(Number(e.target.value)*100)}})}/></label>
        <label className="text-sm sm:col-span-2">Reason for adjustment<Input required={value.pricing.adjustmentCents!==0} value={value.pricing.adjustmentReason} maxLength={500} placeholder="Additional mini-split, extra system, specialty filter, loyalty discount" onChange={e=>onChange({...value,pricing:{...value.pricing,adjustmentReason:e.target.value}})}/></label>
      </div>
      <p className="rounded-lg bg-yellow-50 text-yellow-950 p-3 font-semibold">Membership price: {crownMoney(value.pricing.baseAmountCents+value.pricing.adjustmentCents)} / {value.billingFrequency==="Annual"?"year":"month"}</p>
      <p className="text-xs text-muted-foreground">Adding equipment does not change the price automatically. Set the price above. Saving records the agreed price; it does not charge a card or change an existing invoice.</p>
      </>}
      {(enrollment||lockedPlan)&&<p className="text-xs text-muted-foreground">Saving records membership coverage and the agreed price. It does not charge a card, send a customer message, or activate recurring billing.</p>}
      <label className="block text-sm">Membership notes<Textarea value={value.notes} maxLength={5000} placeholder="Customer preferences, included services, exclusions, or special arrangements" onChange={e=>onChange({...value,notes:e.target.value})}/></label>
    </section>
  </div>;
}
