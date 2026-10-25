import { createClient } from "@supabase/supabase-js";
import {createSessionPreferences,retirableStorage,type SessionStorageChoice} from "./session-persistence";

// Public project configuration. Server authorization and database RLS remain authoritative.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env vars missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Data will not persist."
  );
}

const baseKey = `sb-${new URL(supabaseUrl || "https://unconfigured.invalid").hostname.split(".")[0]}-auth-token`;
const preferences=createSessionPreferences(baseKey,()=>window.localStorage,()=>window.sessionStorage,()=>crypto.randomUUID());
// Storage-denied browsers still render the login page and an actionable error.
// No fallback silently stores a session persistently.
let storageError:Error|null=null;
let selection:SessionStorageChoice;
try {selection=preferences.initial();} catch(error) {
  storageError=error as Error;
  const memory=new Map<string,string>();
  selection={remember:false,storageKey:baseKey+"-unavailable",storage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>{memory.set(key,value);},removeItem:key=>{memory.delete(key);}}};
}
const client=(choice:SessionStorageChoice)=>{
  const guarded=retirableStorage(choice.storage);
  return {retire:guarded.retire,instance:createClient(supabaseUrl ?? "",supabaseAnonKey ?? "",{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:guarded.storage,storageKey:choice.storageKey},
  })};
};
let current=client(selection);
// ES module live binding: every API/data caller uses the currently selected client.
export let supabase=current.instance;
export async function selectSessionPersistence(remember:boolean) {
  if(storageError) { // Retry storage availability after the user changes browser settings.
    try{preferences.initial();storageError=null;}catch(error){throw error;}
  }
  const next=preferences.prepare(remember);
  if(next.storageKey!==selection.storageKey){
    current.retire();
    await supabase.auth.dispose();
    await supabase.removeAllChannels();
    preferences.select(remember);
    selection=next;
    current=client(next);
    supabase=current.instance;
  } else preferences.select(remember);
  return supabase;
}

// Helper: extract the entity object from a jsonb-blob row.
// Tables store { id, company_id, customer_id, data: {...entity} }.
// This returns the parsed entity (or null).
export function extractEntity<T>(row: { data: unknown } | null | undefined): T | null {
  if (!row || !row.data) return null;
  return row.data as T;
}

export function extractEntities<T>(rows: { data: unknown }[] | null | undefined): T[] {
  if (!rows) return [];
  return rows
    .filter((r) => r && r.data && !(r.data as any).deletedAt)
    .map((r) => r.data as T);
}
