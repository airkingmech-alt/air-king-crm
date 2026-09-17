import { supabase } from "./supabase";
import { toast } from "@/hooks/use-toast";
export type RecordWrite = {table:string;id:string;data:any;previous?:any};
export async function saveRecords(records:RecordWrite[]) {
  const {data,error}=await supabase.rpc("crm_save_records",{p_records:records});
  if(error) throw new Error(error.message || "The change could not be saved. Please try again.");
  return data as any[];
}
const active=new Set<string>();
// Keep the form open on failure and suppress repeated clicks during a pending save.
export function guardSave<T extends any[]>(key:string,action:(...args:T)=>Promise<unknown>){
  return async(...args:T)=>{
    // Prevent form navigation even when a repeated submission is ignored.
    args[0]?.preventDefault?.();
    if(active.has(key))return;
    active.add(key);
    try{await action(...args);}catch(e:any){toast({title:"Could not save",description:e.message || "Please try again.",variant:"destructive"});}
    finally{active.delete(key);}
  };
}
