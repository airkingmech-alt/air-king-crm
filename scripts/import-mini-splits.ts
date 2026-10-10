// Keep the verified supplier manifest outside the repository. Dry-run is default.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { authorizeMiniSplitsImport, buildMiniSplitsRows, planMiniSplitsImport } from "../shared/mini-splits-import";

const path = process.argv[2];
const apply = process.argv[3] === "--apply";
if (!path || (process.argv[3] && !apply) || process.argv.length > 4) throw new Error("Usage: node --import tsx scripts/import-mini-splits.ts /private/manifest.json [--apply]");
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AIRKING_IMPORT_ACCESS_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !AIRKING_IMPORT_ACCESS_TOKEN) throw new Error("Set Supabase URL, publishable key, and a staff access token in the environment.");
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${AIRKING_IMPORT_ACCESS_TOKEN}` } },
});
const { data: auth, error: authError } = await sb.auth.getUser(AIRKING_IMPORT_ACCESS_TOKEN);
if (authError || !auth.user) throw new Error("Staff authentication failed.");
const { data: profile, error: profileError } = await sb.from("profiles").select("company_id,role,permissions").eq("id", auth.user.id).single();
if (profileError) throw new Error(profileError.message);
const company = authorizeMiniSplitsImport(profile);
const rows = buildMiniSplitsRows(JSON.parse(readFileSync(path, "utf8")), company);
const existing: Array<{ sku: string | null; model: string | null; brand: string | null }> = [];
for (let offset = 0; ; offset += 500) {
  const { data, error } = await sb.from("price_book_items").select("id,sku,model,brand")
    .eq("company_id", company).order("id").range(offset, offset + 499);
  if (error) throw new Error(error.message);
  existing.push(...(data ?? []));
  if (!data || data.length < 500) break;
}
const missing = planMiniSplitsImport(rows, existing);
console.log(JSON.stringify({ company, sourceRows: rows.length, newRows: missing.length, preservedExisting: rows.length - missing.length, apply }));
if (apply && missing.length) {
  // One atomic insert. The existing case-insensitive unique index rejects a
  // concurrent duplicate; rerun to re-plan after a conflict or lost response.
  const { data: inserted, error } = await sb.from("price_book_items").insert(missing).select("id");
  if (error) throw new Error(error.message);
  if (inserted?.length !== missing.length) throw new Error("Import result could not be verified. Rerun the dry-run.");
  console.log(JSON.stringify({ inserted: inserted.length }));
}
