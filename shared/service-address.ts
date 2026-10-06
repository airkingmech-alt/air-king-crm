/** Only service-location fields belong here: never billing addresses or access codes. */
export interface ServiceAddress {
  address?: string;
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
}
const clean = (value?: string) => (value || "").trim().replace(/\s+/g, " ");
const key = (value?: string) => clean(value).toLocaleLowerCase();

export function formatServiceAddress(property?: ServiceAddress): string {
  if (!property) return "";
  // Imported records retain both street/unit and their combined display address.
  const street = clean(property.street) || clean(property.address);
  const unit = clean(property.unit);
  const line = unit && (clean(property.street) || !key(street).endsWith(", " + key(unit))) ? [street, unit].filter(Boolean).join(", ") : street;
  const region = [clean(property.state), clean(property.zip)].filter(Boolean).join(" ");
  return [line, clean(property.city), region].filter(Boolean).join(", ");
}

export function serviceAddressLinks(address: string) {
  const destination = encodeURIComponent(address);
  return {
    apple: `https://maps.apple.com/?daddr=${destination}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
  };
}

/** Enrich legacy job text only when it identifies exactly one service property. */
export function jobServiceAddress(job?: { property?: string; projectName?: string }, properties: ServiceAddress[] = []): string {
  const saved = clean(job?.property);
  if (!saved || /^(tbd|n\/?a|unknown|not set|to be determined)$/i.test(saved)) return "";
  const matches = properties.filter(property => [property.address, property.street, formatServiceAddress(property)]
    .some(address => !!clean(address) && key(address) === key(saved)));
  if (matches.length === 1) return formatServiceAddress(matches[0]);
  // A street shared by two properties is not enough to infer the unit or locality.
  if (matches.length > 1 || key(saved) === key(job?.projectName)) return "";
  return saved;
}
