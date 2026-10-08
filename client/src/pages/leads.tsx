import { crownTierIds, crownTiers, currentCrownInquiryMetadata, type CrownCatalog, type CrownTierId } from "../../../shared/crown-tiers";
import { updateVersioned } from "../../../shared/versioned-save";
import { guardSave } from "@/lib/confirmed-save";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Inbox, Plus, RefreshCw, UserCheck, Search, ArrowUpRight, Phone, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import { useData } from "@/context/data-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { crm } from "@/lib/crm-api";

type LeadStatus="new"|"contacted"|"qualified"|"appointment"|"quoted"|"won"|"lost"|"spam";
type Lead={metadata?:Record<string,unknown>;source_ref?:string|null;assigned_to?:string|null;last_contact_at?:string|null;converted_at?:string|null;id:string;status:LeadStatus;source:string;name:string;email:string|null;phone:string|null;address:string|null;city:string|null;state:string|null;postal_code:string|null;service_type:string|null;message:string;customer_id:string|null;created_at:string;updated_at:string;company_id:string};
type LeadSource={id:string;name:string;source_key:string;enabled:boolean;secret:string;endpoint:string};
type CrmConfig={connections?:{meta?:boolean;meta_webhook?:string}};
const statuses:LeadStatus[]=["new","contacted","qualified","appointment","quoted","won","lost","spam"];
const blank={name:"",phone:"",email:"",source:"manual",service_type:"",message:"",address:"",city:"",state:"MO",postal_code:""};

export default function Leads(){
 const {profile}=useAuth(); const {addCustomer}=useData(); const qc=useQueryClient(); const {toast}=useToast();
 const [filter,setFilter]=useState<"all"|"open"|LeadStatus>("all"); const [open,setOpen]=useState(false); const [form,setForm]=useState(blank);
 const [search,setSearch]=useState(""); const [selectedId,setSelectedId]=useState<string|null>(null);
 const [linkedLead,setLinkedLead]=useState(()=>new URLSearchParams(window.location.hash.split("?")[1] || "").get("lead"));
 const key=["leads",profile?.company_id];
 const {data:leads=[],isLoading,error:loadError}=useQuery({queryKey:key,enabled:!!profile,refetchInterval:30000,queryFn:async()=>{const {data,error}=await supabase.from("leads").select("*").eq("company_id",profile!.company_id).order("created_at",{ascending:false});if(error)throw error;return data as Lead[]}});
 const {data:sources=[]}=useQuery({queryKey:["crm-lead-sources"],enabled:profile?.role==="owner"||profile?.role==="admin",queryFn:()=>crm("crm/lead-sources") as Promise<LeadSource[]>});
 const {data:config}=useQuery({queryKey:["crm-config"],enabled:!!profile,queryFn:()=>crm("crm/config") as Promise<CrmConfig>});
 const {data:tierCatalog,error:tierCatalogError}=useQuery({queryKey:["crown-care-catalog",profile?.company_id],enabled:!!profile,queryFn:()=>crm("crm/crown-care/catalog") as Promise<{catalog:CrownCatalog;version:string}>});
 const save=useMutation({mutationFn:async()=>{if(!form.name.trim())throw new Error("Lead name is required.");const {error}=await supabase.from("leads").insert({...form,company_id:profile!.company_id,status:"new"});if(error)throw error;},onSuccess:()=>{qc.invalidateQueries({queryKey:key});setOpen(false);setForm(blank);toast({title:"Lead added to inbox"});},onError:(e:Error)=>toast({title:"Could not add lead",description:e.message,variant:"destructive"})});
 const update=guardSave("lead-status",async(l:Lead,status:LeadStatus)=>{
  await updateVersioned(supabase,"leads",l,{status,...(status==="contacted"?{last_contact_at:new Date().toISOString()}: {})});
  await qc.invalidateQueries({queryKey:key});
 });
 const [tierSaving,setTierSaving]=useState(false);
 const saveTier=guardSave("lead-tier-interest",async(l:Lead,tier:CrownTierId|"")=>{
  setTierSaving(true);
  try {
   const previous=l.metadata?.crownCare as Record<string,unknown>|undefined;
   const count=Number(previous?.systemCount);
   const current=tier?await crm("crm/crown-care/catalog") as {catalog:CrownCatalog}:null;
   const snapshot=tier?{...(currentCrownInquiryMetadata({crownCare:{tier,catalogVersion:current!.catalog.version,...(Number.isInteger(count)&&count>=1&&count<=100?{systemCount:count}:{})}},current!.catalog)!.crownCare as Record<string,unknown>),reviewedBy:profile!.id,reviewedAt:new Date().toISOString()}:null;
   await updateVersioned(supabase,"leads",l,{metadata:{...l.metadata,crownCare:snapshot}});
   await qc.invalidateQueries({queryKey:key});
   toast({title:"Tier interest saved",description:"This lead has not been enrolled or billed."});
  } finally {setTierSaving(false);}
 });
 const convert=guardSave("convert-lead",async(l:Lead)=>{
  if(l.customer_id)return;
  await addCustomer({name:l.name,type:"Residential",phone:l.phone||"",email:l.email||"",address:l.address||"",city:l.city||"",state:l.state||"MO",zip:l.postal_code||"",leadSource:l.source},l.id);
  qc.invalidateQueries({queryKey:key});
  toast({title:"Customer created",description:`${l.name} is now in Customers.`});
 });
 useEffect(()=>{const sync=()=>setLinkedLead(new URLSearchParams(window.location.hash.split("?")[1] || "").get("lead"));window.addEventListener("hashchange",sync);return()=>window.removeEventListener("hashchange",sync);},[]);
 useEffect(()=>{if(linkedLead)setSelectedId(linkedLead);},[linkedLead]);
 const selected=leads.find(l=>l.id===selectedId);
 const query=search.trim().toLowerCase();
 const shown=leads.filter(l=>(filter==="all" || (filter==="open"?!["won","lost","spam"].includes(l.status):l.status===filter)) && (!query || [l.name,l.phone,l.email,l.service_type,l.message,l.address,l.city,l.state,l.postal_code,l.source,l.source_ref,JSON.stringify(l.metadata||{})].filter(Boolean).join(" ").toLowerCase().includes(query)));
 const {data:team=[]}=useQuery({queryKey:["lead-assignees",profile?.company_id],enabled:!!profile,queryFn:async()=>{const {data,error}=await supabase.from("profiles").select("id,full_name").eq("company_id",profile!.company_id);if(error)throw error;return data as {id:string;full_name:string|null}[];}});
 const closeDetails=()=>{setSelectedId(null);if(linkedLead){const [path,qs]=window.location.hash.split("?");const params=new URLSearchParams(qs||"");params.delete("lead");window.history.replaceState(null,"",path+(params.size?"?"+params.toString():""));setLinkedLead(null);}};
 return <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
  <div className="flex justify-between items-start gap-3"><div><h1 className="text-xl font-bold">Leads Inbox</h1><p className="text-sm text-muted-foreground">New website, Google, social, phone, and manually entered opportunities in one queue.</p></div><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Refresh leads" onClick={()=>qc.invalidateQueries({queryKey:key})}><RefreshCw size={16}/></Button><Button onClick={()=>setOpen(true)}><Plus size={16} className="mr-2"/>Add lead</Button></div></div>
  <Card><CardContent className="p-4"><div className="flex gap-2 flex-wrap">{(["all","open",...statuses] as const).map(s=><Button key={s} size="sm" variant={filter===s?"default":"outline"} className="capitalize" onClick={()=>setFilter(s)}>{s==="all"?"All leads":s} ({leads.filter(l=>s==="all" || (s==="open"?!["won","lost","spam"].includes(l.status):l.status===s)).length})</Button>)}</div></CardContent></Card>
  <div className="flex flex-col sm:flex-row sm:items-center gap-3"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input aria-label="Search leads" placeholder="Search name, phone, address, service or form answers…" className="pl-9" value={search} onChange={e=>setSearch(e.target.value)}/></div><p className="text-sm text-muted-foreground">{shown.length} of {leads.length} leads</p></div>
  {loadError&&<p role="alert" className="text-sm text-destructive">Could not load leads. Refresh to try again.</p>}
  {isLoading?<p className="text-sm text-muted-foreground">Loading leads…</p>:<div className="space-y-3">{shown.map(l=><Card id={`lead-${l.id}`} key={l.id} onClick={()=>setSelectedId(l.id)} className={`cursor-pointer transition-colors hover:border-primary/50 ${linkedLead===l.id?"ring-2 ring-primary":""}`}><CardContent className="p-4"><div className="flex flex-col lg:flex-row lg:items-center gap-3"><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold min-w-0"><button className="text-left break-words hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={()=>setSelectedId(l.id)}>{l.name}</button></h3><Badge className="capitalize" variant={l.status==="new"?"default":"secondary"}>{l.status}</Badge><Badge variant="outline">{l.source.replaceAll("_"," ")}</Badge>{crownLeadTier(l)&&<Badge variant="outline">Crown Care {crownLeadTier(l)} · inquiry</Badge>}</div><p className="text-sm text-muted-foreground mt-1 break-words">{[l.phone,l.email,l.service_type].filter(Boolean).join(" · ")}</p>{[l.address,l.city,l.state,l.postal_code].some(Boolean)&&<p className="text-sm text-muted-foreground break-words">{[l.address,l.city,l.state,l.postal_code].filter(Boolean).join(", ")}</p>}{l.message&&<p className="text-sm mt-2 line-clamp-3 whitespace-pre-wrap break-words">{l.message}</p>}<p className="text-xs text-muted-foreground mt-2">{new Date(l.created_at).toLocaleString()}</p></div><div className="flex gap-2 flex-wrap" onClick={e=>e.stopPropagation()}><Button variant="outline" onClick={()=>setSelectedId(l.id)}>View details<ArrowUpRight size={16} className="ml-2"/></Button><Select value={l.status} onValueChange={(v:LeadStatus)=>update(l,v)}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent>{statuses.map(s=><SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>{l.customer_id?<Button variant="outline" disabled><UserCheck size={16} className="mr-2"/>Customer linked</Button>:<Button variant="outline" onClick={()=>convert(l)}><UserCheck size={16} className="mr-2"/>Create customer</Button>}</div></div></CardContent></Card>)}</div>}
  {!isLoading&&!loadError&&!shown.length&&<div className="text-center py-14"><Inbox className="mx-auto text-muted-foreground mb-2"/><p className="text-sm text-muted-foreground">No leads in this view.</p></div>}
  <Dialog open={!!selectedId} onOpenChange={v=>{if(!v)closeDetails();}}><DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto w-[calc(100%-2rem)] rounded-lg">
    <DialogHeader><DialogTitle className="pr-6 break-words">{selected?.name || "Lead details"}</DialogTitle><DialogDescription>Complete contact information and everything submitted with this lead.</DialogDescription></DialogHeader>
    {selected ? <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center gap-2"><Badge className="capitalize">{selected.status}</Badge><Badge variant="outline">{selected.source.replaceAll("_"," ")}</Badge>
        {selected.phone&&<Button size="sm" variant="outline" asChild><a href={`tel:${selected.phone.replace(/[^+\d]/g,"")}`}><Phone size={14} className="mr-2"/>Call</a></Button>}
        {selected.email&&<Button size="sm" variant="outline" asChild><a href={`mailto:${selected.email}`}><Mail size={14} className="mr-2"/>Email</a></Button>}
      </div>
      <section className="space-y-2 rounded-lg border p-3"><h3 className="font-semibold">Crown Care tier interest</h3>
        <label className="block text-sm">Proposed tier<select aria-label="Proposed Crown Care tier" disabled={tierSaving||!tierCatalog} className="block w-full rounded-md border bg-background p-2 mt-1" value={crownLeadTier(selected)?.toLowerCase() || ""} onChange={e=>{void saveTier(selected,e.target.value as CrownTierId|"");}}><option value="">No tier selected</option>{crownTierIds.map(id=><option key={id} value={id}>{crownTiers[id].name}{tierCatalog?` · $${(tierCatalog.catalog.tiers[id].annualPerSystemCents/100).toFixed(2)} / system / year`:""}</option>)}</select></label>
        {tierCatalogError&&<p role="alert" className="text-xs text-destructive">Current Crown Care prices could not be loaded. The saved inquiry details below are unchanged.</p>}
        <p className="text-xs text-muted-foreground">Options show current prices. The original inquiry snapshot remains in the form answers below until you change the selection. Confirm covered systems and the customer’s acceptance, then use Crown Care to enroll them. Creating a customer or recording tier interest does not enroll or bill them.</p>
      </section>
      <section className="space-y-3"><h3 className="font-semibold">Contact & service</h3><dl className="grid sm:grid-cols-2 gap-4">
        <Detail label="Name" value={selected.name}/><Detail label="Service needed" value={selected.service_type}/>
        <Detail label="Phone" value={selected.phone}/><Detail label="Email" value={selected.email}/>
        <Detail label="Street address" value={selected.address}/><Detail label="City / state / ZIP" value={[selected.city,selected.state,selected.postal_code].filter(Boolean).join(" ")}/>
        <Detail label="Assigned to" value={team.find(p=>p.id===selected.assigned_to)?.full_name || selected.assigned_to || "Unassigned"}/>
      </dl></section>
      <section className="space-y-2"><h3 className="font-semibold">Full message / request</h3><p className="whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-sm">{selected.message || "No message provided."}</p></section>
      <section className="space-y-2"><h3 className="font-semibold">Form answers & additional information</h3>{Object.keys(selected.metadata||{}).length ? <LeadInformation value={selected.metadata}/> : <p className="text-sm text-muted-foreground">No additional information was submitted.</p>}</section>
      <section className="space-y-3"><h3 className="font-semibold">Lead record</h3><dl className="grid sm:grid-cols-2 gap-4">
        <Detail label="Source" value={selected.source}/><Detail label="Source reference" value={selected.source_ref}/>
        <Detail label="Received" value={leadDate(selected.created_at)}/><Detail label="Last updated" value={leadDate(selected.updated_at)}/>
        <Detail label="Last contacted" value={leadDate(selected.last_contact_at)}/><Detail label="Converted to customer" value={leadDate(selected.converted_at)}/>
        <Detail label="Lead ID" value={selected.id}/>
      </dl></section>
      <div className="flex flex-wrap items-end gap-3 border-t pt-4"><div className="space-y-1"><Label>Status</Label><Select value={selected.status} onValueChange={(v:LeadStatus)=>update(selected,v)}><SelectTrigger aria-label="Lead status" className="w-40"><SelectValue/></SelectTrigger><SelectContent>{statuses.map(s=><SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select></div>
        {selected.customer_id?<Button variant="outline" asChild><a href={`#/customers/${encodeURIComponent(selected.customer_id)}`}><UserCheck size={16} className="mr-2"/>Open customer</a></Button>:<Button variant="outline" onClick={()=>convert(selected)}><UserCheck size={16} className="mr-2"/>Create customer</Button>}
        <Button variant="outline" onClick={async()=>{const url=new URL(window.location.href);url.hash=`/leads?lead=${selected.id}`;await navigator.clipboard.writeText(url.toString());toast({title:"Lead link copied"});}}>Copy lead link</Button>
      </div>
    </div> : <p role="status" className="text-sm text-muted-foreground">{isLoading?"Loading lead…":loadError?"Could not load lead. Close and refresh to try again.":"This lead is no longer available or you do not have access to it."}</p>}
  </DialogContent></Dialog>
  <Card><CardContent className="p-4"><details><summary className="font-semibold cursor-pointer">Intake integrations</summary><p className="text-sm text-muted-foreground mt-1">Use these secure endpoints for the Air King website, Google, Meta lead ads, call tracking, or Zapier/Make. Send the token in an <code>X-Lead-Token</code> header and a unique <code>source_ref</code> with each submission.</p>
   <div className="mt-3 rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-sm font-medium">Facebook & Instagram Lead Ads</p><Badge className={config?.connections?.meta?"bg-green-100 text-green-800":"bg-amber-100 text-amber-800"}>{config?.connections?.meta?"Connected":"Finish setup"}</Badge></div><p className="text-xs text-muted-foreground mt-1">New Meta lead-form submissions arrive here automatically.</p></div>{config?.connections?.meta_webhook&&<Button size="sm" variant="outline" onClick={async()=>{await navigator.clipboard.writeText(config.connections!.meta_webhook!);toast({title:"Meta callback copied"})}}><Copy size={14} className="mr-1"/>Copy callback URL</Button>}</div>
   {!!sources.length&&<div className="mt-3 grid gap-2 sm:grid-cols-2">{sources.map(source=><div key={source.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-medium">{source.name}</p><p className="text-xs text-muted-foreground">{source.source_key}</p></div><Button size="sm" variant="outline" onClick={async()=>{await navigator.clipboard.writeText(JSON.stringify({endpoint:source.endpoint,method:"POST",headers:{"Content-Type":"application/json","X-Lead-Token":source.secret},body:{name:"Customer name",phone:"816-555-1234",email:"customer@example.com",service_type:"AC repair",message:"How can Air King help?",source_ref:"unique-provider-id"}},null,2));toast({title:`${source.name} setup copied`})}}><Copy size={14} className="mr-1"/>Copy setup</Button></div></div>)}</div>}
  </details></CardContent></Card>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Add lead</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3">
   <Field label="Name"><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field><Field label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
   <Field label="Email"><Input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field><Field label="Source"><Input value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></Field>
   <Field label="Service needed"><Input value={form.service_type} onChange={e=>setForm({...form,service_type:e.target.value})}/></Field><Field label="Address"><Input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field>
   <Field label="City"><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></Field><Field label="State"><Input value={form.state} onChange={e=>setForm({...form,state:e.target.value})}/></Field><Field label="ZIP code"><Input value={form.postal_code} onChange={e=>setForm({...form,postal_code:e.target.value})}/></Field>
   <div className="sm:col-span-2"><Field label="Message"><Textarea value={form.message} onChange={e=>setForm({...form,message:e.target.value})}/></Field></div>
  </div><DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Saving…":"Add lead"}</Button></DialogFooter></DialogContent></Dialog>
 </div>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>}

function leadDate(value?:string|null){if(!value)return "Not recorded";const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString();}
function Detail({label,value}:{label:string;value?:string|null}){return <div className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="text-sm mt-1 whitespace-pre-wrap break-words">{value||"Not provided"}</dd></div>;}
function informationLabel(key:string){return key.replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/[_-]/g," ").replace(/^./,c=>c.toUpperCase());}
function LeadInformation({value,depth=0}:{value:unknown;depth?:number}):React.ReactNode{
 if(value===null||value===undefined)return <span className="text-muted-foreground">Not provided</span>;
 if(typeof value==="boolean")return <span>{value?"Yes":"No"}</span>;
 if(typeof value!=="object")return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
 if(depth>=6)return <pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(value,null,2)}</pre>;
 if(Array.isArray(value))return value.length?<ul className="space-y-2 list-disc pl-4">{value.map((v,i)=><li key={i}><LeadInformation value={v} depth={depth+1}/></li>)}</ul>:<span className="text-muted-foreground">None</span>;
 const entries=Object.entries(value);return entries.length?<dl className="space-y-3 rounded-lg border p-3 text-sm min-w-0">{entries.map(([key,v])=><div key={key} className="min-w-0"><dt className="font-medium break-words">{informationLabel(key)}</dt><dd className="mt-1 min-w-0"><LeadInformation value={v} depth={depth+1}/></dd></div>)}</dl>:<span className="text-muted-foreground">None</span>;
}

function crownLeadTier(lead:Lead){const tier=(lead.metadata?.crownCare as {tier?:unknown}|undefined)?.tier;return crownTierIds.includes(tier as CrownTierId)?crownTiers[tier as CrownTierId].name:null;}
