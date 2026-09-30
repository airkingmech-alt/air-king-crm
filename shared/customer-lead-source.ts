export const UNKNOWN_LEAD_SOURCE = "Unknown";

// Preserve a deliberately selected/imported source; never infer advertising.
export function normalizeLeadSource(source?: string | null): string {
  return source?.trim() || UNKNOWN_LEAD_SOURCE;
}
