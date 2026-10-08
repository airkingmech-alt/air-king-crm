export const staffRoles = ["owner", "admin", "technician", "dispatcher"];
export function canAccess(profile: {role?: string; permissions?: Record<string, boolean>} | null | undefined, feature: string) {
  return !!profile && staffRoles.includes(profile.role || "") && (profile.role === "owner" || profile.permissions?.[feature] !== false);
}
// Feature flags apply to server operations, including routes outside the sidebar.
export function requestFeatures(path: string, method = "GET"): string[] {
  // Express route matching is case-insensitive by default; authorization must be too.
  const p = path.split("?")[0].toLowerCase();
  if (p.startsWith("/api/time-clock")) return ["time_clock"];
  if (p.startsWith("/api/scheduling")) return ["schedule"];
  if (p.startsWith("/api/equipment")) return ["customers"];
  if (!p.startsWith("/api/crm/")) return [];
  const part = p.split("/")[3];
  const feature: Record<string,string> = {quote:"quotes",quotes:"quotes",invoice:"invoices",invoices:"invoices",memberships:"memberships",customers:"customers",inventory:"inventory",marketing:"marketing",referrals:"referrals",coupons:"referrals",automations:"automations",runs:"automations",starters:"automations",templates:"communications",messages:"communications","lead-sources":"leads",reports:"reports"};
  if (part === "config") return method === "GET" ? [] : ["communications"];
  const required = feature[part] ? [feature[part]] : [];
  if(part === "reports") required.push("invoices");
  if (/\/(send|email|remind)$/.test(p)) required.push("communications");
  if (/\/quotes\/[^/]+\/convert$/.test(p)) required.push("schedule");
  if (/\/quotes\/[^/]+\/invoice$/.test(p)) required.push("invoices");
  if (part === "marketing") required.push("customers", "quotes", "invoices", "schedule", "communications");
  if (/\/customers\/[^/]+\/history$/.test(p) || part === "messages") required.push("customers", "quotes", "invoices", "schedule", "communications");
  return Array.from(new Set(required));
}
