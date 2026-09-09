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
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=company_id,role,full_name`,
    { headers: supabaseHeaders(authHeader) }
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
          `${SUPABASE_URL}/rest/v1/profiles?company_id=eq.${companyId}&select=id,full_name,role&order=role.asc`,
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

  // === AI Photo Analysis endpoint ===
  // Kept server-side because it uses the ANTHROPIC_API_KEY secret, which must
  // never be exposed in the browser bundle. All other data access now goes
  // directly from the browser to Supabase (see lib/supabase.ts).
  app.post("/api/analyze-photo", async (req: any, res: any) => {
    const { image, fileName } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image provided" });
    }

    const base64Match = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      return res.status(400).json({ error: "Invalid image format" });
    }

    const mediaType = base64Match[1] === "jpg" ? "image/jpeg" : `image/${base64Match[1]}`;
    const base64Data = base64Match[2];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey });

        const message = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaType as any, data: base64Data },
                },
                {
                  type: "text",
                  text: "You are an HVAC technician reviewing a photo from a customer's property. Analyze this image and provide a concise note (2-3 sentences) for the customer record. Focus on: equipment type, condition, any visible issues, and recommended next steps. If you cannot see HVAC equipment, describe what you see and note it may not be HVAC-related. Keep it professional and brief.",
                },
              ],
            },
          ],
        });

        const note = message.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join(" ");

        return res.json({ note: note || "Analysis completed but no text returned." });
      } catch (err: any) {
        console.error("Anthropic API error:", err.message);
      }
    }

    // Fallback: simulated analysis (used when no API key is configured, e.g. pplx.app sandbox)
    const lowerName = (fileName || "").toLowerCase();
    let simulatedNote = "";

    if (lowerName.includes("ac") || lowerName.includes("condenser") || lowerName.includes("outdoor")) {
      simulatedNote = "Outdoor condenser unit visible. Unit appears to be in moderate condition with some weathering on the cabinet. Recommend cleaning coils and checking refrigerant levels during next service visit. No immediate concerns visible.";
    } else if (lowerName.includes("furnace") || lowerName.includes("indoor") || lowerName.includes("attic")) {
      simulatedNote = "Indoor furnace/air handler visible. Unit appears older — check heat exchanger and filter condition. Recommend scheduling a fall tune-up to verify safe operation before heating season.";
    } else if (lowerName.includes("duct") || lowerName.includes("vent")) {
      simulatedNote = "Ductwork visible in the image. Check for proper sealing at joints and adequate insulation. Visible ductwork appears serviceable — recommend duct cleaning if not done within the last 3-5 years.";
    } else if (lowerName.includes("thermostat") || lowerName.includes("control")) {
      simulatedNote = "Thermostat/control panel visible. Appears to be a standard model — consider upgrading to a Wi-Fi smart thermostat for improved efficiency and remote control capabilities.";
    } else if (lowerName.includes("coil") || lowerName.includes("evap")) {
      simulatedNote = "Evaporator coil visible. Check for frost buildup and cleanliness. Recommend coil cleaning if dirty — impacts efficiency and air quality.";
    } else {
      simulatedNote = "Photo uploaded for customer record. Review image for equipment type, condition, and any visible issues. Schedule a follow-up visit if equipment appears to need service or replacement.";
    }

    return res.json({ note: simulatedNote, source: "simulated" });
  });

  return httpServer;
}
