import type { AddOnService } from "../../../shared/quote-addons";
import type { AcceptedQuoteScope } from "../../../shared/accepted-quote";

// Workflow-only additions to the existing data contracts. Keep fixture records
// separate from production workflow changes; this file has no runtime data.
declare module "./mock-data" {
  interface QuoteOption {
    equipmentSummary?: string;
  }
  interface Quote {
    acceptedScope?: AcceptedQuoteScope;
    addOnCatalog?: AddOnService[];
    revisionOf?: string;
  }
  interface WorkOrder {
    durationMinutes?: number;
    technicianId?: string | null;
  }
}
