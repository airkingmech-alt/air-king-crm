import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { addOnServices, pricebook as legacyEquipment } from "@/data/pricebook";

type ItemType = "equipment" | "part" | "service" | "labor";
type PriceItem = {
  id:string; company_id:string; item_type:ItemType; category:string; name:string;
  description:string; sku:string|null; brand:string|null; model:string|null; unit:string;
  cost_cents:number; price_cents:number; taxable:boolean; active:boolean;
};
const empty = { item_type:"part" as ItemType, category:"Parts", name:"", description:"", sku:"", brand:"", model:"", unit:"each", cost:"0", price:"0", taxable:true };
const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);

export default function Pricebook(){
  const { profile }=useAuth(); const qc=useQueryClient(); const {toast}=useToast();
  const [tab,setTab]=useState<"all"|ItemType>("all"); const [search,setSearch]=useState("");
  const [open,setOpen]=useState(false); const [editing,setEditing]=useState<PriceItem|null>(null);
  const [form,setForm]=useState(empty);
  const [importing,setImporting]=useState(false);
  const key=["price-book",profile?.company_id];
  const {data:items=[],isLoading}=useQuery({queryKey:key,enabled:!!profile,queryFn:async()=>{
    const {data,error}=await supabase.from("price_book_items").select("*").eq("company_id",profile!.company_id).order("active",{ascending:false}).order("name");
    if(error) throw error; return data as PriceItem[];
  }});
  useEffect(()=>{
    if(isLoading||items.length||importing||!profile||!["owner","admin"].includes(profile.role)) return;
    setImporting(true);
    const equipmentRows=legacyEquipment.map(item=>({
      company_id:profile.company_id,item_type:"equipment",category:item.category,name:item.description,
      description:item.description,sku:item.model,brand:item.brand,model:item.model,unit:"each",
      cost_cents:Math.round(item.cost*100),price_cents:Math.round((item.cost/0.8)*100),taxable:true,active:true,
      metadata:{legacy_id:item.id,tier:item.tier||null,tonnage:item.tonnage||null},
    }));
    const serviceRows=addOnServices.map(item=>({
      company_id:profile.company_id,item_type:"service",category:"Add-ons",name:item.name,
      description:item.description,sku:`ADDON-${item.id}`,brand:null,model:null,unit:"each",
      cost_cents:0,price_cents:Math.round(item.price*100),taxable:true,active:true,
      metadata:{legacy_id:item.id},
    }));
    (async()=>{
      const {error}=await supabase.from("price_book_items").upsert([...equipmentRows,...serviceRows],{onConflict:"company_id,sku",ignoreDuplicates:true});
      if(error) toast({title:"Could not import the existing catalog",description:error.message,variant:"destructive"});
      else qc.invalidateQueries({queryKey:["price-book",profile.company_id]});
      setImporting(false);
    })();
  },[importing,isLoading,items.length,profile,qc,toast]);
  const shown=useMemo(()=>items.filter(i=>(tab==="all"||i.item_type===tab)&&[i.name,i.description,i.sku,i.brand,i.model].some(v=>(v||"").toLowerCase().includes(search.toLowerCase()))),[items,tab,search]);
  const save=useMutation({mutationFn:async()=>{
    if(!form.name.trim()) throw new Error("Item name is required.");
    const row={company_id:profile!.company_id,item_type:form.item_type,category:form.category.trim()||"Other",name:form.name.trim(),description:form.description.trim(),sku:form.sku.trim()||null,brand:form.brand.trim()||null,model:form.model.trim()||null,unit:form.unit.trim()||"each",cost_cents:Math.round(Number(form.cost||0)*100),price_cents:Math.round(Number(form.price||0)*100),taxable:form.taxable,active:true};
    const q=editing?supabase.from("price_book_items").update(row).eq("id",editing.id):supabase.from("price_book_items").insert(row);
    const {error}=await q; if(error) throw error;
  },onSuccess:()=>{qc.invalidateQueries({queryKey:key});setOpen(false);setEditing(null);setForm(empty);toast({title:editing?"Item updated":"Item added"});},onError:(e:Error)=>toast({title:"Could not save item",description:e.message,variant:"destructive"})});
  const archive=async(i:PriceItem)=>{const {error}=await supabase.from("price_book_items").update({active:false}).eq("id",i.id);if(error)toast({title:"Could not archive item",description:error.message,variant:"destructive"});else qc.invalidateQueries({queryKey:key});};
  const edit=(i:PriceItem)=>{setEditing(i);setForm({item_type:i.item_type,category:i.category,name:i.name,description:i.description,sku:i.sku||"",brand:i.brand||"",model:i.model||"",unit:i.unit,cost:(i.cost_cents/100).toFixed(2),price:(i.price_cents/100).toFixed(2),taxable:i.taxable});setOpen(true);};
  return <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-bold">Price Book</h1><p className="text-sm text-muted-foreground">Equipment, parts, services, and labor used on quotes and invoices.</p></div><Button onClick={()=>{setEditing(null);setForm(empty);setOpen(true)}}><Plus size={16} className="mr-2"/>Add item</Button></div>
    <div className="flex gap-2 flex-wrap">{(["all","equipment","part","service","labor"] as const).map(x=><Button key={x} size="sm" variant={tab===x?"default":"outline"} onClick={()=>setTab(x)} className="capitalize">{x==="all"?"All":x==="part"?"Parts":x}</Button>)}</div>
    <div className="relative"><Search className="absolute left-3 top-2.5 text-muted-foreground" size={16}/><Input className="pl-9" placeholder="Search name, SKU, brand, or model…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {isLoading||importing?<p className="text-sm text-muted-foreground">{importing?"Importing the existing Air King equipment catalog…":"Loading price book…"}</p>:<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{shown.map(i=><Card key={i.id} className={!i.active?"opacity-55":""}><CardContent className="p-4 space-y-2"><div className="flex justify-between gap-2"><div><div className="flex gap-2 items-center"><Badge variant="secondary" className="capitalize">{i.item_type}</Badge>{!i.active&&<Badge variant="outline">Archived</Badge>}</div><h3 className="font-semibold mt-2">{i.name}</h3><p className="text-xs text-muted-foreground">{i.sku||i.model||i.category}</p></div><div className="text-right"><p className="font-bold">{money(i.price_cents)}</p><p className="text-xs text-muted-foreground">Cost {money(i.cost_cents)}</p></div></div><p className="text-sm text-muted-foreground line-clamp-2">{i.description||"No description"}</p><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={()=>edit(i)} aria-label="Edit"><Pencil size={15}/></Button>{i.active&&<Button size="icon" variant="ghost" onClick={()=>archive(i)} aria-label="Archive"><Trash2 size={15}/></Button>}</div></CardContent></Card>)}</div>}
    {!isLoading&&!shown.length&&<p className="text-center py-12 text-sm text-muted-foreground">No matching items. Add the first item to this section.</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{editing?"Edit price book item":"Add price book item"}</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-4">
      <Field label="Name"><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
      <Field label="Type"><Select value={form.item_type} onValueChange={(v:ItemType)=>setForm({...form,item_type:v,category:v==="part"?"Parts":form.category})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{(["equipment","part","service","labor"] as const).map(x=><SelectItem key={x} value={x} className="capitalize">{x}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Category"><Input value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></Field><Field label="SKU / part number"><Input value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></Field>
      <Field label="Brand"><Input value={form.brand} onChange={e=>setForm({...form,brand:e.target.value})}/></Field><Field label="Model"><Input value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></Field>
      <Field label="Cost"><Input type="number" min="0" step=".01" value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})}/></Field><Field label="Selling price"><Input type="number" min="0" step=".01" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></Field>
      <div className="sm:col-span-2"><Field label="Customer-facing description"><Input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field></div>
    </div><DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={()=>save.mutate()} disabled={save.isPending}>{save.isPending?"Saving…":"Save item"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>}
