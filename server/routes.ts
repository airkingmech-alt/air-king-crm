import type { Express } from "express";
import type { Server } from "node:http";

// Supabase project config. The secret key is read from the environment:
//  - Render (production): SUPABASE_SERVICE_ROLE_KEY env var (set by the user)
//  - Local dev: injected via the credential proxy as CUSTOM_CRED_..._TOKEN
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://vnqtoehunolxvxywrizj.supabase.co";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.CUSTOM_CRED_VNQTOEHUNOLXVXYWRIZJ_SUPABASE_CO_TOKEN ||
  "";

// Call the Supabase REST/ Auth API with the secret key on the `apikey` header.
// The new sb_secret_... keys are NOT JWTs, so they must go on `apikey` (not
// Authorization: Bearer, which Supabase rejects as "Invalid JWT").
function supabaseHeaders(token: string, extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    apikey: token,
    ...extra,
  };
}

// Verify the caller's JWT and load their profile (role + company_id).
// The caller's access token IS a JWT, so it goes on Authorization: Bearer.
async function getCallerProfile(authHeader?: string) {
  if (!authHeader) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SERVICE_ROLE_KEY },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: string; email?: string };
  // Load the caller's own profile row (RLS allows self-read).
  // The caller's JWT goes on Authorization; the service key goes on apikey.
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=company_id,role,full_name`,
    { headers: { ...supabaseHeaders(SERVICE_ROLE_KEY), Authorization: authHeader } }
  );
  if (!pRes.ok) return null;
  const rows = (await pRes.json()) as any[];
  const profile = rows[0];
  if (!profile) return null;
  return { user, profile };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // === Admin: list users (owner only) ===
  app.get("/api/admin/users", async (req: any, res: any) => {
    if (!SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured for user management." });
    const caller = await getCallerProfile(req.headers.authorization);
    if (!caller) return res.status(401).json({ error: "Not authenticated." });
    if (caller.profile.role !== "owner")
      return res.status(403).json({ error: "Only owners can manage users." });

    const companyId = caller.profile.company_id;
    try {
      // Fetch company profiles (bypasses RLS via service role).
      const [profRes, usersRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/profiles?company_id=eq.${companyId}&select=id,full_name,role,permissions&order=role.asc`,
          { headers: supabaseHeaders(SERVICE_ROLE_KEY) }
        ),
        fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
          headers: supabaseHeaders(SERVICE_ROLE_KEY),
        }),
      ]);
      const profiles = (await profRes.json()) as any[];
      const userList = ((await usersRes.json()) as any).users || [];
      const emailById = new Map(userList.map((u: any) => [u.id, u.email]));
      const merged = profiles.map((p) => ({
        id: p.id,
        email: emailById.get(p.id) ?? "(unknown)",
        full_name: p.full_name ?? "",
        role: p.role,
        permissions: p.permissions || {},
      }));
      return res.json({ users: merged });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to load users: " + err.message });
    }
  });

  // === Admin: add a user (owner only) ===
  app.post("/api/admin/users", async (req: any, res: any) => {
    if (!SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured for user management." });
    const caller = await getCallerProfile(req.headers.authorization);
    if (!caller) return res.status(401).json({ error: "Not authenticated." });
    if (caller.profile.role !== "owner")
      return res.status(403).json({ error: "Only owners can add users." });

    const { email, password, full_name, role } = req.body || {};
    if (!email || !password || !full_name || !role)
      return res.status(400).json({ error: "Email, password, name, and role are required." });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    const validRoles = ["admin", "technician", "dispatcher"];
    if (!validRoles.includes(role))
      return res.status(400).json({ error: "Role must be admin, technician, or dispatcher." });

    const companyId = caller.profile.company_id;
    try {
      // 1. Create the auth user (email confirmed so they can log in immediately).
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: supabaseHeaders(SERVICE_ROLE_KEY),
        body: JSON.stringify({
          email: String(email).trim(),
          password,
          email_confirm: true,
          user_metadata: { full_name, role },
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        const msg =
          created?.message?.includes("already") || created?.code === 422
            ? "A user with that email already exists."
            : created?.message || "Could not create user.";
        return res.status(400).json({ error: msg });
      }
      // 2. Create the profile row (same company as the owner).
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: "POST",
        headers: supabaseHeaders(SERVICE_ROLE_KEY, { Prefer: "return=representation" }),
        body: JSON.stringify({
          id: created.id,
          company_id: companyId,
          role,
          full_name,
        }),
      });
      if (!profRes.ok) {
        const body = await profRes.text();
        return res.status(500).json({ error: "User created but profile failed: " + body });
      }
      return res.json({ user: { id: created.id, email, full_name, role } });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to add user: " + err.message });
    }
  });

  // === Admin: update role and feature permissions (owner only) ===
  app.patch("/api/admin/users/:id/permissions", async (req: any, res: any) => {
    if (!SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured for user management." });
    const caller = await getCallerProfile(req.headers.authorization);
    if (!caller) return res.status(401).json({ error: "Not authenticated." });
    if (caller.profile.role !== "owner") return res.status(403).json({ error: "Only owners can manage permissions." });
    const targetId = String(req.params.id);
    if (targetId === caller.user.id) return res.status(400).json({ error: "Owner access cannot be restricted." });
    const allowed = ["customers","leads","quotes","schedule","pricebook","invoices","inventory","memberships","referrals","marketing","automations","communications","reports","time_clock","time_clock_edit_own"];
    const incoming = req.body?.permissions || {};
    const permissions = Object.fromEntries(allowed.map((key) => [key, incoming[key] !== false]));
    const role = req.body?.role;
    if (role && !["admin","technician","dispatcher","member"].includes(role))
      return res.status(400).json({ error: "Invalid role." });
    const patch: any = { permissions };
    if (role) patch.role = role;
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}&company_id=eq.${encodeURIComponent(caller.profile.company_id)}`,
        { method: "PATCH", headers: supabaseHeaders(SERVICE_ROLE_KEY, { Prefer: "return=representation" }), body: JSON.stringify(patch) }
      );
      const body = await response.json();
      if (!response.ok) return res.status(400).json({ error: body?.message || "Could not update permissions." });
      if (!body.length) return res.status(404).json({ error: "User not found." });
      return res.json({ user: body[0] });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to update permissions: " + err.message });
    }
  });

  // Old photo uploads are preserved, but analysis requires explicit review in Equipment.
  app.post("/api/analyze-photo", async (_req, res) => {
    res.status(410).json({ error: "Use Scan Equipment Nameplate in the customer's Equipment tab to analyze and confirm equipment." });
  });

  return httpServer;
}
