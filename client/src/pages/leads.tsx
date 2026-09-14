import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Plus, RefreshCw, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import { useData } from "@/context/data-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type LeadStatus="new"|"contacted"|"qualified"|"appointment"|"quoted"|"won"|"lost"|"spam";
type Lead={id:string;status:LeadStatus;source:string;name:string;email:string|null;phone:string|null;address:string|null;city:string|null;state:string|null;postal_code:string|null;service_type:string|null;message:string;customer_id:string|null;created_at:string};
const statuses:LeadStatus[]=["new","contacted","qualified","appointment","quoted","won","lost","spam"];
const blank={name:"",phone:"",email:"",source:"manual",service_type:"",message:"",address:"",city:"",state:"MO",postal_code:""};

export default function Leads(){
 const {profile}=useAuth(); const {addCustomer}=useData(); const qc=useQueryClient(); const {toast}=useToast();
 const [filter,setFilter]=useState<"open"|LeadStatus>("open"); const [open,setOpen]=useState(false); const [form,setForm]=useState(blank);
 const key=["leads",profile?.company_id];
 const {data:leads=[],isLoading}=useQuery({queryKey:key,enabled:!!profile,refetchInterval:30000,queryFn:async()=>{const {data,error}=await supabase.from("leads").select("*").eq("company_id",profile!.company_id).order("created_at",{ascending:false});if(error)throw error;return data as Lead[]}});
 const save=useMutation({mutationFn:async()=>{if(!form.name.trim())throw new Error("Lead name is required.");const {error}=await supabase.from("leads").insert({...form,company_id:profile!.company_id,status:"new"});if(error)throw error;},onSuccess:()=>{qc.invalidateQueries({queryKey:key});setOpen(false);setForm(blank);toast({title:"Lead added to inbox"});},onError:(e:Error)=>toast({title:"Could not add lead",description:e.message,variant:"destructive"})});
 const update=async(id:string,status:LeadStatus)=>{const {error}=await supabase.from("leads").update({status,last_contact_at:status==="contacted"?new Date().toISOString():undefined}).eq("id",id);if(error)toast({title:"Could not update lead",description:error.message,variant:"destructive"});else qc.invalidateQueries({queryKey:key});};
 const convert=async(l:Lead)=>{if(l.customer_id)return;const c=addCustomer({name:l.name,type:"Residential",phone:l.phone||"",email:l.email||"",address:l.address||"",city:l.city||"",state:l.state||"MO",zip:l.postal_code||"",leadSource:l.source});const {error}=await supabase.from("leads").update({customer_id:c.id,status:"qualified",converted_at:new Date().toISOString()}).eq("id",l.id);if(error)toast({title:"Customer created; lead link needs retry",description:error.message,variant:"destructive"});else{qc.invalidateQueries({queryKey:key});toast({title:"Customer created",description:`${l.name} is now in Customers.`});}};
 const shown=leads.filter(l=>filter==="open"?!["won","lost","spam"].includes(l.status):l.status===filter);
 return <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
  <div className="flex justify-between items-start gap-3"><div><h1 className="text-xl font-bold">Leads Inbox</h1><p className="text-sm text-muted-foreground">New website, Google, social, phone, and manually entered opportunities in one queue.</p></div><div className="flex gap-2"><Button variant="outline" size="icon" onClick={()=>qc.invalidateQueries({queryKey:key})}><RefreshCw size={16}/></Button><Button onClick={()=>setOpen(true)}><Plus size={16} className="mr-2"/>Add lead</Button></div></div>
  <Card><CardContent className="p-4"><div className="flex gap-2 flex-wrap">{(["open",...statuses] as const).map(s=><Button key={s} size="sm" variant={filter===s?"default":"outline"} className="capitalize" onClick={()=>setFilter(s)}>{s}{s==="new"&&` (${leads.filter(l=>l.status==="new").length})`}</Button>)}</div></CardContent></Card>
  {isLoading?<p className="text-sm text-muted-foreground">Loading leads…</p>:<div className="space-y-3">{shown.map(l=><Card key={l.id}><CardContent className="p-4"><div className="flex flex-col lg:flex-row lg:items-center gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><h3 className="font-semibold">{l.name}</h3><Badge className="capitalize" variant={l.status==="new"?"default":"secondary"}>{l.status}</Badge><Badge variant="outline">{l.source.replaceAll("_"," ")}</Badge></div><p className="text-sm text-muted-foreground mt-1">{[l.phone,l.email,l.service_type].filter(Boolean).join(" · ")}</p>{l.message&&<p className="text-sm mt-2 line-clamp-2">{l.message}</p>}<p className="text-xs text-muted-foreground mt-2">{new Date(l.created_at).toLocaleString()}</p></div><div className="flex gap-2 flex-wrap"><Select value={l.status} onValueChange={(v:LeadStatus)=>update(l.id,v)}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent>{statuses.map(s=><SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>{l.customer_id?<Button variant="outline" disabled><UserCheck size={16} className="mr-2"/>Customer linked</Button>:<Button variant="outline" onClick={()=>convert(l)}><UserCheck size={16} className="mr-2"/>Create customer</Button>}</div></div></CardContent></Card>)}</div>}
  {!isLoading&&!shown.length&&<div className="text-center py-14"><Inbox className="mx-auto text-muted-foreground mb-2"/><p className="text-sm text-muted-foreground">No leads in this view.</p></div>}
  <Card><CardContent className="p-4"><h2 className="font-semibold">Intake integrations</h2><p className="text-sm text-muted-foreground mt-1">The database is ready for website forms, Google Business Profile, Meta lead ads, call tracking, and Zapier/Make webhooks. Each source should send a unique source reference so duplicate submissions are ignored.</p></CardContent></Card>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Add lead</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3">
   <Field label="Name"><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field><Field label="Phone"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
   <Field label="Email"><Input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field><Field label="Source"><Input value={form.source} onChange={e=>setForm({...form,source:e.target.value})}/></Field>
   <Field label="Service needed"><Input value={form.service_type} onChange={e=>setForm({...form,service_type:e.target.value})}/></Field><Field label="Address"><Input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field>
   <div className="sm:col-span-2"><Field label="Message"><Textarea value={form.message} onChange={e=>setForm({...form,message:e.target.value})}/></Field></div>
  </div><DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Saving…":"Add lead"}</Button></DialogFooter></Dialog>
 </div>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>}
