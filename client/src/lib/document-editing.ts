import type { Invoice, Quote, QuoteOption, WorkOrder } from "@/data/mock-data";
import { calculateQuotePricing } from "./quote-pricing";
import { formatEquipmentDescription, pricebook } from "@/data/pricebook";

export const quoteJobTypes = ["Changeout", "Service Call", "New Construction", "Maintenance", "Commercial"] as const;
export const quoteIsAccepted = (quote: Quote) => quote.status === "Won" || !!quote.acceptedScope;
export const invoiceIsSettled = (invoice: Invoice) => ["Paid", "Partial", "Void"].includes(invoice.status) || invoice.paidAmount > 0;
export const invoiceScopeLocked = (invoice: Invoice, jobs: WorkOrder[] = []) =>
  !!invoice.quoteId || !!(invoice as Invoice & { quoteAcceptance?: unknown }).quoteAcceptance ||
  jobs.some(job => job.id === invoice.workOrderId && !!job.quoteId);

export function editMoney(value: string, label: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new Error(`${label} must be zero or more, with at most two decimal places.`);
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > 100000000) throw new Error(`${label} is too large.`);
  return amount;
}
function required(value: string, label: string, max = 2000) {
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} is required and must be ${max} characters or fewer.`);
  return text;
}
export type QuoteOptionForm = Omit<QuoteOption, "customerPrice" | "features"> & { customerPrice: string; featureText: string };
export type QuoteEditForm = {
  customerName: string; title: string; jobType: Quote["jobType"]; laborDescription: string;
  laborCost: string; materialsCost: string; options: QuoteOptionForm[]; selectedAddOns: string[];
};
export function quoteEditForm(quote: Quote): QuoteEditForm {
  return { customerName: quote.customerName, title: quote.title, jobType: quote.jobType,
    laborDescription: quote.laborDescription || "", laborCost: String(quote.laborCost ?? 0), materialsCost: String(quote.materialsCost ?? 0),
    options: quote.options.map(option => ({ ...structuredClone(option), customerPrice: String(option.customerPrice), featureText: (option.features || []).join("\n") })),
    selectedAddOns: [...(quote.selectedAddOns || [])] };
}
export function recalculateQuoteOption(option: QuoteOptionForm, equipmentIds: string[], laborCost: string, materialsCost: string): QuoteOptionForm {
  const items = equipmentIds.map(id => {
    const item = pricebook.find(candidate => candidate.id === id);
    if (!item) throw new Error("An equipment model is no longer in the pricebook. Choose its replacement before recalculating.");
    return item;
  });
  const pricing = calculateQuotePricing(items.reduce((sum, item) => sum + item.cost, 0), editMoney(laborCost, "Labor cost"), editMoney(materialsCost, "Materials cost"));
  const modelsChanged = JSON.stringify(option.equipmentItems || []) !== JSON.stringify(equipmentIds);
  return { ...option, featureText: modelsChanged ? "" : option.featureText, equipmentItems: [...equipmentIds], equipment: items.map(item => item.model).join(" + "),
    equipmentSummary: items.map(item => `${formatEquipmentDescription(item)} — ${item.model}`).join("\n"),
    efficiency: "Matched-system efficiency to be verified", equipmentCost: pricing.equipmentCost,
    purchaseTax: pricing.purchaseTax, totalCost: pricing.totalCost, customerPrice: String(pricing.customerPrice) };
}
export function quoteEditChanges(quote: Quote, form: QuoteEditForm) {
  if (quoteIsAccepted(quote)) throw new Error("Create a draft revision to change an accepted quote.");
  if (!quoteJobTypes.includes(form.jobType)) throw new Error("Choose a valid job type.");
  if (form.options.length < 1 || form.options.length > 3 || new Set(form.options.map(option => option.tier)).size !== form.options.length)
    throw new Error("Keep one to three options with different tiers.");
  const internalCostsChanged = form.laborCost !== String(quote.laborCost ?? 0) || form.materialsCost !== String(quote.materialsCost ?? 0);
  const options = form.options.map(({ featureText, ...option }) => ({ ...option,
    ...(internalCostsChanged && quote.pricingVersion === "purchase-tax-v1" && option.equipmentCost !== undefined ? (() => { const costs = calculateQuotePricing(option.equipmentCost!, editMoney(form.laborCost, "Labor cost"), editMoney(form.materialsCost, "Materials cost")); return { totalCost: costs.totalCost, purchaseTax: costs.purchaseTax }; })() : {}),
    label: required(option.label, "Option name", 200), equipment: option.equipment.trim(),
    features: featureText.split("\n").map(line => line.trim()).filter(Boolean),
    customerPrice: editMoney(option.customerPrice, `${option.tier} price`) }));
  const changes: Record<string, unknown> = { customerName: required(form.customerName, "Customer name", 300),
    title: required(form.title, "Quote title"), jobType: form.jobType, laborDescription: form.laborDescription.trim(),
    laborCost: editMoney(form.laborCost, "Labor cost"), materialsCost: editMoney(form.materialsCost, "Materials cost"),
    options, selectedAddOns: [...form.selectedAddOns] };
  // Only send changed fields: text edits never reprice old options or replace historical equipment.
  return Object.fromEntries(Object.entries(changes).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((quote as any)[key])));
}
export type InvoiceEditForm = { customerName: string; projectName: string; constructionStage: string; dueDate: string; items: { description: string; amount: string }[] };
export function invoiceEditForm(invoice: Invoice): InvoiceEditForm {
  return { customerName: invoice.customerName, projectName: invoice.projectName || "", constructionStage: invoice.constructionStage || "", dueDate: invoice.dueDate,
    items: (invoice.items || []).map(item => ({ description: item.description, amount: String(item.amount) })) };
}
export function invoiceEditChanges(invoice: Invoice, form: InvoiceEditForm, scopeLocked: boolean) {
  if (invoiceIsSettled(invoice)) throw new Error("Paid, partly paid, and void invoices retain their original billing history.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate) || !Number.isFinite(Date.parse(form.dueDate)) || new Date(form.dueDate).toISOString().slice(0, 10) !== form.dueDate || form.dueDate < "1900-01-01" || form.dueDate > "2200-12-31")
    throw new Error("Enter a valid due date.");
  if (!["", "Rough-in", "Finish"].includes(form.constructionStage)) throw new Error("Choose a valid construction stage.");
  if (form.projectName.trim().length > 200) throw new Error("Project name must be 200 characters or fewer.");
  if (form.constructionStage && !form.projectName.trim()) throw new Error("Enter the house address or project / lot name.");
  const changes: Record<string, unknown> = { projectName: form.projectName.trim(), constructionStage: form.constructionStage || null, dueDate: form.dueDate };
  if (!scopeLocked) {
    if (!form.items.length || form.items.length > 100) throw new Error("Add between one and 100 invoice items.");
    const items = form.items.map(item => ({ description: required(item.description, "Item description", 2000), amount: editMoney(item.amount, "Item amount") }));
    const cents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10000000000) throw new Error("Invoice total must be greater than zero and no more than $100,000,000.");
    Object.assign(changes, { customerName: required(form.customerName, "Customer name", 300), items, amount: cents / 100 });
  }
  return Object.fromEntries(Object.entries(changes).filter(([key, value]) => JSON.stringify(value ?? "") !== JSON.stringify((invoice as any)[key] ?? "")));
}

// Even an unchanged form compares its opening snapshot with the server. Never
// replace a fresh cache entry with an old dialog snapshot on a no-op save.
export async function persistDocumentEdit(kind: "quote" | "invoice", original: Quote | Invoice, changes: Record<string, unknown>, rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>) {
  const { data, error } = await rpc("crm_edit_document", { p_kind: kind, p_id: original.id, p_previous: original, p_changes: changes });
  if (error) throw new Error(error.message);
  if (!data || data.id !== original.id) throw new Error("The save was not confirmed. Refresh before trying again.");
  return data;
}
