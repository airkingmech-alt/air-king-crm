import { createClient } from "@supabase/supabase-js";

// Public anon key — safe to expose in the browser. Security is enforced by
// Row Level Security policies on the database (see supabase/ SQL files).
// Phase 1 uses permissive policies for staging/demo data; Phase 2 (auth)
// tightens these to per-user access.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env vars missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Data will not persist."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  auth: { persistSession: false },
});

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
    .filter((r) => r && r.data)
    .map((r) => r.data as T);
}
