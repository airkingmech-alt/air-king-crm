import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

export interface CustomerNote {
  id: string;
  customerId: string;
  text: string;
  author: string;
  date: string;
}

const columns = "id, customer_id, text, author, date";
const fromRow = (row: any): CustomerNote => ({
  id: row.id,
  customerId: row.customer_id,
  text: row.text,
  author: row.author,
  date: row.date,
});

export const customerNotesKey = (userId: string, companyId: string, customerId: string) =>
  ["customer-notes", userId, companyId, customerId] as const;

export function customerNotesQueryOptions(client: SupabaseClient, userId: string, companyId: string, customerId: string) {
  return {
    queryKey: customerNotesKey(userId, companyId, customerId),
    queryFn: ({ signal }: { signal: AbortSignal }) => loadCustomerNotes(client, companyId, customerId, signal),
    enabled: !!(userId && companyId && customerId),
    staleTime: 0,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: true,
    retry: false,
  };
}

export async function loadCustomerNotes(client: SupabaseClient, companyId: string, customerId: string, signal?: AbortSignal): Promise<CustomerNote[]> {
  if (!companyId || !customerId) throw new Error("A signed-in company and customer are required to load notes.");
  const notes: CustomerNote[] = [];
  for (let start = 0; ; start += 500) {
    let query = client.from("customer_notes").select(columns)
      .eq("company_id", companyId).eq("customer_id", customerId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(start, start + 499);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(error.message || "Customer notes could not be loaded.");
    if (!Array.isArray(data)) throw new Error("Customer notes could not be loaded. Please retry.");
    notes.push(...data.map(fromRow));
    if (data.length < 500) return notes;
  }
}

// A successful write status alone is insufficient: an ignored duplicate or a
// missing/hidden row must not make the form claim that this note was saved.
export async function saveCustomerNote(client: SupabaseClient, companyId: string, note: CustomerNote): Promise<CustomerNote> {
  if (!companyId || !note.customerId || !note.id || !note.text.trim()) {
    throw new Error("A signed-in company, customer, and note are required.");
  }
  const { error } = await client.from("customer_notes").upsert({
    id: note.id, company_id: companyId, customer_id: note.customerId,
    text: note.text, author: note.author, date: note.date,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(error.message || "The note could not be saved. Please retry.");
  const { data, error: readError } = await client.from("customer_notes").select(columns)
    .eq("company_id", companyId).eq("customer_id", note.customerId).eq("id", note.id).single();
  if (readError) throw new Error("The note save could not be verified. Please retry. " + readError.message);
  if (!data || data.id !== note.id || data.customer_id !== note.customerId || data.text !== note.text) {
    throw new Error("The note save could not be verified. Please refresh and review before trying again.");
  }
  return fromRow(data);
}

export async function cacheSavedCustomerNote(queryClient: QueryClient, userId: string, companyId: string, note: CustomerNote) {
  const queryKey = customerNotesKey(userId, companyId, note.customerId);
  // An older in-flight read must not hide the newly confirmed note.
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<CustomerNote[]>(queryKey, previous => [note, ...(previous || []).filter(item => item.id !== note.id)]);
  void queryClient.invalidateQueries({ queryKey, exact: true });
}

// Compare the original text in the same UPDATE that writes the replacement.
// A read followed by an unconditional write would lose concurrent edits.
export async function updateCustomerNote(client: SupabaseClient, companyId: string, original: CustomerNote, text: string): Promise<CustomerNote> {
  if (!companyId || !original.customerId || !original.id || !text.trim()) {
    throw new Error("A signed-in company, customer, and nonempty note are required.");
  }
  const scope = () => client.from("customer_notes").select(columns)
    .eq("company_id", companyId).eq("customer_id", original.customerId).eq("id", original.id);
  const { data, error } = await client.from("customer_notes").update({ text })
    .eq("company_id", companyId).eq("customer_id", original.customerId).eq("id", original.id)
    .eq("text", original.text).select(columns);
  if (error) throw new Error(error.message || "The note could not be saved. Please retry.");
  // A retry after a committed write with a lost response matches no old text.
  // Verify the scoped row instead of repeating an unconditional update.
  let row: NonNullable<typeof data>[number] | null | undefined = data?.[0];
  if (!row) {
    const { data: current, error: readError } = await scope().maybeSingle();
    if (readError) throw new Error("The note save could not be verified. Please retry. " + readError.message);
    row = current;
  }
  if (!row || row.id !== original.id || row.customer_id !== original.customerId || row.text !== text) {
    throw new Error("This note changed or is no longer available. Your draft is retained. Cancel and reopen the latest note before editing again.");
  }
  return fromRow(row);
}

export async function cacheUpdatedCustomerNote(queryClient: QueryClient, userId: string, companyId: string, original: CustomerNote, saved: CustomerNote) {
  const queryKey = customerNotesKey(userId, companyId, original.customerId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<CustomerNote[]>(queryKey, previous => previous?.map(note =>
    note.id === saved.id && (note.text === original.text || note.text === saved.text) ? saved : note));
  // Preserve ordering and any newer cached edit; a fresh read resolves races.
  void queryClient.invalidateQueries({ queryKey, exact: true });
}
