import { supabase } from "./supabase";

// Supabase caps individual responses. Use stable pages so the whole catalog is searchable.
export async function fetchCatalogItems(companyId: string, activeOnly = false) {
  const result: any[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("price_book_items").select("*").eq("company_id", companyId).order("id");
    if (activeOnly) query = query.eq("active", true);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    result.push(...(data ?? []));
    if (!data || data.length < pageSize) return result;
  }
}
