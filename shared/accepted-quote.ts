import type { AddOnService } from "./quote-addons";

// Captured transactionally when the quote is accepted, never reconstructed
// from the current catalog or a salesperson's later on-screen selection.
export interface AcceptedQuoteScope {
  version: 1;
  quoteId: string;
  customerId: string;
  customerName: string;
  title: string;
  laborDescription: string;
  selectedOption: string;
  selectedAddOns: string[];
  option: { tier: string; label: string; customerPrice: number; equipment?: string; equipmentSummary?: string; equipmentItems?: string[] };
  addOns: AddOnService[];
  items: { description: string; amount: number }[];
  equipmentItems: string[];
  amount: number;
}
