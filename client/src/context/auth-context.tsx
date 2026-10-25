import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, selectSessionPersistence } from "@/lib/supabase";

export type AppRole = "owner" | "admin" | "technician" | "dispatcher" | "member";

export interface Profile {
  id: string;
  company_id: string;
  role: AppRole;
  full_name: string | null;
  permissions: Record<string, boolean>;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string, remember?: boolean) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authClient,setAuthClient]=useState(supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active=true,revision=0;
    const restore=async()=>{
      const current=++revision;
      try {
        const {data,error}=await authClient.auth.getSession();
        if(!active||current!==revision)return;
        if(error) {setSession(null);setProfile(null);return;}
        setSession(data.session);
        if(!data.session?.user){setProfile(null);return;}
        const {data:row}=await authClient.from("profiles")
          .select("id, company_id, role, full_name, permissions")
          .eq("id",data.session.user.id).maybeSingle();
        if(active&&current===revision)setProfile((row as Profile)??null);
      } catch {if(active&&current===revision){setSession(null);setProfile(null);}}
      finally {if(active&&current===revision)setLoading(false);}
    };
    void restore();
    // Keep SDK callbacks synchronous; profile queries run outside its auth lock.
    const {data:sub}=authClient.auth.onAuthStateChange(()=>{setTimeout(()=>{if(active)void restore();},0);});
    return ()=>{active=false;revision++;sub.subscription.unsubscribe();};
  },[authClient]);

  const signIn=useCallback(async(email:string,password:string,remember=false)=>{
    try {
      const selected=await selectSessionPersistence(remember);
      setAuthClient(selected);
      const {error}=await selected.auth.signInWithPassword({email:email.trim(),password});
      return {error:error?.message??null};
    } catch {
      return {error:"Unable to sign in. Check your connection and allow browser storage, then try again."};
    }
  },[]);

  const signOut = useCallback(async () => {
    const {error}=await supabase.auth.signOut();
    if(error)throw error;
    setProfile(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
