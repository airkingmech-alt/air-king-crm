import type { CustomerImportFields } from "../../../shared/customer-import";
import "./mock-data";

// Keep prototype fixtures untouched; production JSON has additive import fields.
declare module "./mock-data" {
  interface Customer extends CustomerImportFields {}
  interface Contact {
    phoneNumbers?: { label: string; value: string }[];
    additionalEmails?: string[];
    sourceText?: string;
  }
  interface Property {
    street?: string;
    unit?: string;
    sourceSlot?: number;
  }
}
