import type { SupabaseClient } from "@supabase/supabase-js";

type EditableTable = "price_book_items" | "leads" | "message_templates" | "automations";
export async function updateVersioned(
  client: SupabaseClient,
  table: EditableTable,
  original: { id: string; company_id: string; updated_at: string },
  changes: Record<string, unknown>,
) {
  if (!original.updated_at) throw Object.assign(new Error("Refresh this record before saving."), { status: 409 });
  const { data, error } = await client.from(table).update(changes)
    .eq("id", original.id).eq("company_id", original.company_id)
    .eq("updated_at", original.updated_at).select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error("This record changed or is no longer available. Refresh and review the latest version before saving."), { status: 409 });
  return data;
}
