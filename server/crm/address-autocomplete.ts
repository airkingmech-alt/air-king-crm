import type { Express } from "express";
import { z } from "zod";
import { caller, db } from "./core";
import {
  ADDRESS_MANUAL_FALLBACK, ADDRESS_MIN_CHARACTERS, ADDRESS_RESULT_LIMIT,
  safeAttributionUrl, type AddressSuggestion, type AddressSuggestionsResponse,
} from "../../shared/address-autocomplete";

const querySchema = z.object({ text: z.string().trim().min(ADDRESS_MIN_CHARACTERS).max(250) }).strict();
const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

/** Geoapify address_line1 can be a business name, so use house number + street. */
export function mapAddressSuggestions(data: unknown): AddressSuggestion[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as any).results)) return [];
  const suggestions: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of (data as any).results) {
    if (!item || typeof item !== "object" || text(item.country_code).toLowerCase() !== "us") continue;
    const streetName = text(item.street);
    if (!streetName) continue;
    const street = [text(item.housenumber, 50), streetName].filter(Boolean).join(" ");
    const city = text(item.city || item.town || item.village, 150);
    // Do not infer Missouri from the proximity bias. Kansas and all US states remain valid.
    const state = text(item.state_code, 30).replace(/^US-/i, "").toUpperCase();
    const postalCode = text(item.postcode, 20);
    const key = [street, city, state, postalCode].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const source = item.datasource && typeof item.datasource === "object" ? item.datasource : {};
    const placeId = text(item.place_id, 1000);
    suggestions.push({
      id: placeId || `address-${suggestions.length}`,
      label: text(item.formatted) || [street, city, [state, postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      street, city, state, postalCode,
      provenance: {
        provider: "geoapify", selectedAt: new Date().toISOString(), ...(placeId ? { placeId } : {}),
        source: {
          name: text(source.sourcename, 200) || undefined,
          attribution: text(source.attribution, 1000) || undefined,
          license: text(source.license, 200) || undefined,
          url: safeAttributionUrl(source.url),
        },
      },
    });
    if (suggestions.length === ADDRESS_RESULT_LIMIT) break;
  }
  return suggestions;
}

export interface AddressQuotaReservation { allowed: boolean; retry_after_seconds?: number; reason?: string }
export async function reserveAddressRequest(): Promise<AddressQuotaReservation> {
  const { data, error } = await db().rpc("crm_reserve_address_request");
  if (error || !data || typeof data.allowed !== "boolean") throw new Error("Address quota unavailable");
  return data;
}

type Dependencies = {
  apiKey?: () => string | undefined;
  reserve?: () => Promise<AddressQuotaReservation>;
  fetch?: typeof fetch;
};

export async function addressSuggestions(query: string, dependencies: Dependencies = {}): Promise<AddressSuggestionsResponse> {
  const fallback = { suggestions: [], available: false, message: ADDRESS_MANUAL_FALLBACK };
  const apiKey = (dependencies.apiKey || (() => process.env.GEOAPIFY_API_KEY))()?.trim();
  // Missing provider configuration never consumes quota or calls a third party.
  if (!apiKey) return fallback;
  const parsed = querySchema.safeParse({ text: query });
  if (!parsed.success) return fallback;
  try {
    // Shared, durable, atomic reservation happens before EVERY external attempt.
    // No retries here. A later user request must reserve again, including after timeouts.
    const quota = await (dependencies.reserve || reserveAddressRequest)();
    if (quota.allowed !== true) return { ...fallback, retryAfterSeconds: quota.retry_after_seconds };
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.search = new URLSearchParams({ text: parsed.data.text, format: "json", filter: "countrycode:us",
      bias: "proximity:-94.5786,39.0997", limit: String(ADDRESS_RESULT_LIMIT), lang: "en", apiKey }).toString();
    // Never log this URL, request body, raw provider errors, address text, or credentials.
    const response = await (dependencies.fetch || fetch)(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
    });
    if (!response.ok) return fallback;
    const suggestions = mapAddressSuggestions(await response.json());
    return { suggestions, available: true };
  } catch {
    // Quota DB errors and provider failures fail closed while manual editing continues.
    return fallback;
  }
}

export function registerAddressAutocomplete(app: Express, suggest = addressSuggestions) {
  // POST keeps typed addresses out of browser history, URL/access logs and referrers.
  app.post("/api/crm/customers/address-suggestions", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      // Existing caller() verifies the token, staff profile, company and customers permission.
      await caller(req);
      const input = querySchema.safeParse(req.body);
      if (!input.success) return res.status(400).json({ suggestions: [], available: false, message: "Enter 3–250 characters, or enter the address manually." });
      return res.json(await suggest(input.data.text));
    } catch (error: any) {
      const status = error?.status === 401 ? 401 : error?.status === 403 ? 403 : 503;
      // Do not echo upstream error text; it may include a typed address or URL.
      return res.status(status).json({ suggestions: [], available: false, message: ADDRESS_MANUAL_FALLBACK });
    }
  });
}
