import { documentNumber } from "../../../shared/document-number";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import NewHouseBuilder from "@/components/new-house/new-house-builder";
import { ductItems } from "@/components/new-house/duct-catalog";
import "@/components/new-house/new-house.css";
import { CustomerCombobox } from "@/components/customer-combobox";
import { useData } from "@/context/data-context";
import { useAuth } from "@/context/auth-context";
import { pricebook } from "@/data/pricebook";
import { newHouseQuoteInput } from "@/lib/new-house-quote";
import { readTakeoffRecovery, takeoffRecoveryKey } from "@/lib/new-house-recovery";
import { Button } from "@/components/ui/button";

const equipment=pricebook.filter(item=>item.brand==="Champion"||item.brand==="Guardian").map(item=>({...item,brand:item.brand as "Champion"|"Guardian"}));

export default function NewHouseQuote() {
  const { quotes, loadError } = useData();
  const { profile } = useAuth();
  const [, params] = useRoute("/quotes/new-house/:id");
  if (params?.id && !quotes.find(quote => quote.id === params.id)?.newHouseSnapshot) {
    return <div className="p-6">{loadError || "Loading saved takeoff. If it remains unavailable, return to Quotes and refresh."} <Link href="/quotes">Back to Quotes</Link></div>;
  }
  if (!profile) return null;
  return <NewHouseQuoteForm key={`${profile.company_id}:${profile.id}:${params?.id || "new"}`} recoveryKey={takeoffRecoveryKey(profile.company_id,profile.id,params?.id)} />;
}

function NewHouseQuoteForm({recoveryKey}:{recoveryKey:string}) {
  const {customers,quotes,createQuote,loadError}=useData();
  const [,params]=useRoute("/quotes/new-house/:id");
  const [,navigate]=useLocation();
  const saved=params?.id ? quotes.find(quote=>quote.id===params.id) : undefined;
  const snapshot=saved?.newHouseSnapshot;
  const [recovery]=useState(()=>readTakeoffRecovery(sessionStorage,recoveryKey));
  const [editing,setEditing]=useState(Boolean(recovery));
  const [customerId,setCustomerId]=useState(()=>recovery?.customerId||saved?.customerId||new URLSearchParams(window.location.hash.split("?")[1]||window.location.search).get("customer")||"");
  const customer=customers.find(customer=>customer.id===customerId);
  const [propertyId,setPropertyId]=useState(recovery?.propertyId||snapshot?.propertyId||"");
  const property=customer?.properties.find(property=>property.id===propertyId);
  const [started,setStarted]=useState(Boolean(snapshot||recovery));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [storageError,setStorageError]=useState(false);
  const [showDiscard,setShowDiscard]=useState(false);
  const saving=useRef(false);
  const finished=useRef(false);
  const readOnly=Boolean(snapshot&&!editing);
  const clearRecovery=()=>{sessionStorage.removeItem(recoveryKey);};
  const discard=()=>{
    finished.current=true;
    try{clearRecovery();}catch{/* Storage may be disabled. */}
    navigate("/quotes");
  };
  const leave=()=>{if(saving.current)return;if(!started||readOnly)discard();else setShowDiscard(true);};
  const remember=useCallback((state:Record<string,unknown>)=>{
    if(finished.current)return;
    try{sessionStorage.setItem(recoveryKey,JSON.stringify({version:1,customerId,propertyId,state}));setStorageError(false);}
    catch{setStorageError(true);}
  },[recoveryKey,customerId,propertyId]);
  useEffect(()=>{
    if(!started||readOnly)return;
    const warn=(event:BeforeUnloadEvent)=>{if(storageError){event.preventDefault();event.returnValue="";}};
    // Recovery handles browser back and route links. If storage is unavailable,
    // intercept links as well as unload so failure is never silently ignored.
    const guard=(event:MouseEvent)=>{if(storageError&&(event.target as Element)?.closest?.("a[href]")&&!window.confirm("Recovery is unavailable. Leave and discard this takeoff?")){event.preventDefault();event.stopPropagation();}};
    window.addEventListener("beforeunload",warn);document.addEventListener("click",guard,true);
    return()=>{window.removeEventListener("beforeunload",warn);document.removeEventListener("click",guard,true);};
  },[started,readOnly,storageError]);
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy} onClick={leave}>{readOnly?"Back to Quotes":"Cancel"}</Button>{saved&&<Link href={`/proposals/${saved.id}`}>View / edit saved proposal</Link>}{readOnly&&<Button onClick={()=>setEditing(true)}>Edit takeoff as new draft</Button>}</div>
    {showDiscard&&<div role="alertdialog" aria-label="Discard unsaved takeoff" className="border rounded p-4 space-y-3"><p>Discard this unsaved takeoff and its recovery copy? Saved quotes stay unchanged.</p><Button variant="outline" onClick={()=>setShowDiscard(false)}>Keep working</Button> <Button variant="destructive" onClick={discard}>Discard takeoff</Button></div>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    {storageError&&<p role="alert" className="text-destructive">Recovery storage is unavailable. Keep this page open until you save or cancel.</p>}
    {snapshot ? <p>{readOnly?`Saved takeoff for ${documentNumber(saved)}. Proposal edits may differ from these original inputs.`:`Editing a copy of ${documentNumber(saved)}. Saving creates a separate Draft using current CRM equipment pricing and these takeoff allowances. Original proposal prices, scope, add-ons and approvals are not copied or changed. Review the new proposal before sending.`}</p> : !started ? <div className="space-y-4 max-w-xl">
      <h1 className="text-xl font-bold">New House Quote</h1><p>Select an existing CRM customer and service property.</p>
      <CustomerCombobox value={customerId} allowCreate={false} onChange={id=>{setCustomerId(id);setPropertyId("");}}/>
      <label className="block">Service property<select className="block border rounded p-2 w-full bg-background" value={propertyId} onChange={event=>setPropertyId(event.target.value)}><option value="">Select a property</option>{customer?.properties.map(property=><option key={property.id} value={property.id}>{property.address}, {property.city}</option>)}</select></label>
      <Button disabled={!property||!!loadError} onClick={()=>setStarted(true)}>Start New House Bid</Button>
    </div>:<p>{customer?.name} · {property?.address}. Duct and trade allowances require supplier review.</p>}
    {started&&!readOnly&&<p className="text-sm">{recovery?"Recovered takeoff. ":""}Work is kept in this browser tab while you navigate or refresh. Save a Draft before closing the tab. Cancel discards this work.</p>}
    {started&&<div className="crm-new-house"><NewHouseBuilder key={`${params?.id||`${customerId}:${propertyId}`}:${editing}`} equipment={equipment} ductItems={ductItems} initialState={recovery?.state||snapshot?.state} readOnly={readOnly} busy={busy} onStateChange={remember}
      initialProject={{customer:customer?.name||"",address:[property?.address,property?.city,property?.state,property?.zip].filter(Boolean).join(", "),email:customer?.contacts[0]?.email||"",phone:customer?.contacts[0]?.phone||""}}
      onBuildQuote={async(project,lines,state)=>{
        if(saving.current||readOnly)return;
        saving.current=true;setBusy(true);setError("");
        try{
          if(!customer||!property||loadError)throw new Error("Customer records are unavailable. Refresh before saving.");
          const input=newHouseQuoteInput(customer,property.id,project,lines,state);
          if(saved&&input.newHouseSnapshot)input.newHouseSnapshot.sourceQuoteId=saved.id;
          const quote=await createQuote(input);
          finished.current=true;
          try{clearRecovery();}catch{/* A confirmed save must still open its proposal. */}
          navigate(`/proposals/${quote.id}`);
        }catch(error){setError(error instanceof Error?error.message:"Could not save. Your takeoff is still open.");}
        finally{saving.current=false;setBusy(false);}
      }}/></div>}
  </div>;
}
