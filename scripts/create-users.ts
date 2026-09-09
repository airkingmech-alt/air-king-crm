// Creates the 3 Air King user logins + profile rows, and disables
// public signup. Run AFTER 003_phase2_auth_rls.sql has been executed
// (so the profiles table exists). Uses the service role key via the
// credential proxy — the key never appears in this file.
//
//   api_credentials=["custom-cred:vnqtoehunolxvxywrizj.supabase.co"]
//   npx tsx scripts/create-users.ts
import httpx from "httpx"; // not used; we use fetch below

const PROJECT = "vnqtoehunolxvxywrizj";
const BASE = `https://${PROJECT}.supabase.co`;

const USERS = [
  { email: "colton@airkingmech.com", password: "AirKing-2026!", role: "owner", full_name: "Colton Nichols" },
  { email: "james@airkingmech.com", password: "AirKing-2026!", role: "technician", full_name: "James Nichols" },
  { email: "sarah@airkingmech.com", password: "AirKing-2026!", role: "dispatcher", full_name: "Sarah Nichols" },
];

async function adminCreateUser(u: (typeof USERS)[number]) {
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name, role: u.role },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (String(data?.message || "").includes("already been registered") || res.status === 400) {
      // user exists — fetch their id
      const list = await fetch(`${BASE}/auth/v1/admin/users?per_page=1000`, {
        headers: { "Content-Type": "application/json" },
      });
      const lj = await list.json();
      const found = (lj.users || []).find((x: any) => x.email === u.email);
      return { id: found?.id, status: "exists" };
    }
    throw new Error(`create ${u.email} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return { id: data.id, status: "created" };
}

async function upsertProfile(userId: string, u: (typeof USERS)[number]) {
  const res = await fetch(`${BASE}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: userId,
      company_id: "air-king",
      role: u.role,
      full_name: u.full_name,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`profile upsert for ${u.email} failed: ${res.status} ${body}`);
  }
  return res.json();
}

(async () => {
  console.log(`Creating ${USERS.length} users on ${BASE} ...`);
  for (const u of USERS) {
    const r = await adminCreateUser(u);
    console.log(`  ${u.email}: ${r.status} (id=${r.id})`);
    if (r.id) {
      await upsertProfile(r.id, u);
      console.log(`    profile: company_id=air-king role=${u.role}`);
    }
  }

  // Best-effort: disable public signup so randos can't self-register.
  try {
    const res = await fetch(`${BASE}/auth/v1/admin/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signup: { disable_signup: true } }),
    });
    console.log(`Disable public signup: ${res.ok ? "done" : "skipped (" + res.status + ")"}`);
  } catch (e) {
    console.log("Disable public signup: skipped (do it in Supabase Auth settings)");
  }
  console.log("Done. Logins: colton/james/sarah @airkingmech.com  pw: AirKing-2026!");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
