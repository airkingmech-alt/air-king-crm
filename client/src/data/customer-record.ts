import type { Customer as ExistingCustomer } from "./mock-data";

// Imported historical contacts have no inferred sales-lead stage.
export type CustomerRecord = Omit<ExistingCustomer, "leadStatus"> & {
  leadStatus?: ExistingCustomer["leadStatus"];
};
