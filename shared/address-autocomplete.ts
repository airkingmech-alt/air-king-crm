/** Only selected, displayed address data is saved; never the typed query or coordinates. */
export interface AddressProvenance {
  provider: "geoapify";
  selectedAt: string;
  placeId?: string;
  source?: { name?: string; attribution?: string; license?: string; url?: string };
}

export interface AddressSuggestion {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  provenance: AddressProvenance;
}

export interface AddressSuggestionsResponse {
  suggestions: AddressSuggestion[];
  available: boolean;
  message?: string;
  retryAfterSeconds?: number;
}

export const ADDRESS_MIN_CHARACTERS = 3;
export const ADDRESS_DEBOUNCE_MS = 300;
export const ADDRESS_RESULT_LIMIT = 5;
export const ADDRESS_MANUAL_FALLBACK = "Address suggestions are unavailable. You can still enter every field manually.";

/** Allow only ordinary HTTPS attribution links, never HTML, credentials or script URLs. */
export function safeAttributionUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Public source credits only: no customer addresses, place IDs or selection times. */
export function distinctAddressAttributions(values: (AddressProvenance | undefined)[]): AddressProvenance[] {
  const sources = new Map<string, AddressProvenance>();
  for (const value of values) {
    if (value?.provider !== "geoapify") continue;
    const source = value.source ? {
      name: value.source.name, attribution: value.source.attribution,
      license: value.source.license, url: safeAttributionUrl(value.source.url),
    } : undefined;
    const key = JSON.stringify(source || {});
    if (!sources.has(key)) sources.set(key, { provider: "geoapify", selectedAt: "", ...(source ? { source } : {}) });
  }
  return Array.from(sources.values());
}
