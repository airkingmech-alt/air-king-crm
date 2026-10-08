import { useMemo } from "react";
import { useData } from "@/context/data-context";
import { distinctAddressAttributions } from "../../../shared/address-autocomplete";
import { AddressAttribution } from "./address-attribution";

/** Keeps credits visible where saved addresses are reused in pickers and schedules,
 * without nesting attribution links inside existing links or picker buttons. */
export function AddressAttributionFooter() {
  const { customers } = useData();
  const credits = useMemo(() => distinctAddressAttributions(customers.flatMap(customer => [
    customer.billingAddressProvenance, ...customer.properties.map(property => property.addressProvenance),
  ])), [customers]);
  if (!credits.length) return null;
  return <footer aria-label="Address data attribution" className="shrink-0 border-t border-border bg-background px-4 py-1.5">
    {credits.map((credit, index) => <AddressAttribution key={index} provenance={credit} />)}
  </footer>;
}
