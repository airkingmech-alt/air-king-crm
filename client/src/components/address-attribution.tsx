import React from "react";
import { safeAttributionUrl, type AddressProvenance } from "../../../shared/address-autocomplete";

export function AddressAttribution({ provenance }: { provenance?: AddressProvenance }) {
  if (!provenance || provenance.provider !== "geoapify") return null;
  const source = provenance.source;
  const sourceUrl = safeAttributionUrl(source?.url);
  return <span className="block text-[11px] leading-relaxed text-muted-foreground">
    <a className="underline" href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Powered by Geoapify</a>
    {" · "}<a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
    {source?.attribution && <> · {sourceUrl ? <a className="underline" href={sourceUrl} target="_blank" rel="noopener noreferrer">{source.attribution}</a> : source.attribution}</>}
  </span>;
}
