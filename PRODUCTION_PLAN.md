# Air King CRM — Production App Plan & Cost Map

**Goal:** Turn the working prototype into a real, multi-user app with permanent data, login accounts, online payments, and phone access — for a 3-person HVAC company.

---

## The Stack (what we'd build on)

| Piece | Service | Why |
|-------|---------|-----|
| App code | Your existing React + Express app | Already built — runs anywhere, no rewrite |
| Database | **Supabase** (Postgres) | Permanent, reliable, handles multiple users at once. Includes Auth + file storage. |
| Hosting | **Railway** or **Vercel** | Runs the app 24/7 on a real URL. Railway is simplest for a small team. |
| Payments | **Stripe** | Online invoice payments, card-on-file. Industry standard, no monthly fee. |
| Phone app | **PWA** (installable web app) | Home-screen icon, full-screen — no App Store needed. |

---

## Phased Plan

Each phase is fully working and tested before moving to the next. You can stop after any phase and still have a usable app.

### Phase 1 — Foundation: Real database + hosting
- Set up Supabase (Postgres database)
- Migrate your data model (customers, quotes, invoices, schedule, Crown Care) from local SQLite to Supabase
- Deploy the app to a live, permanent URL (Railway or Vercel)
- Replace in-app storage with the real database
- **Result:** Data is permanent, survives restarts, one shared live app.

### Phase 2 — Accounts & login (multi-user)
- Add Supabase Auth (email/password + optional Google sign-in)
- Each person (you, James, Sarah) logs in with their own account
- Company data is shared; actions are tied to who's logged in
- Optional: role-based access (Owner sees everything; Technician sees assigned jobs)
- **Result:** Multiple people using it at once, securely.

### Phase 3 — Payments (Stripe)
- Connect a Stripe account
- "Pay Now" buttons on invoices → customers pay online by card
- Optional: collect deposits or store card-on-file
- **Result:** Customers pay invoices online; money hits your bank in ~2 days.

### Phase 4 — Mobile / PWA polish
- Make the app installable (home-screen icon, full-screen, no browser bar)
- Tune the layout for phone screens (field use)
- Optional: offline-friendly mode for spotty signal
- **Result:** Opens like a native app on any phone.

---

## Monthly Cost (verified pricing, Sept 2026)

### Fixed infrastructure
| Service | Plan | Cost/mo | Notes |
|---------|------|---------|-------|
| **Supabase** (database + auth + storage) | Pro | **$25** | 8GB DB, 250GB storage, 100GB transfer. Includes Auth — no separate login service needed. ([Supabase](https://supabase.com/pricing)) |
| **Hosting** (Railway) | Starter | **~$5** | Runs the app 24/7. Alternative: Vercel Pro at $20/user/mo if you want the Vercel ecosystem. ([Railway](https://railway.com/pricing)) |
| **Custom domain** (optional) | .com | **~$1/mo** (~$12/yr) | e.g. airkingcrm.com. Or use the free built-in subdomain. |
| | | **~$30–45/mo** | Total fixed |

### Payment processing (only when you get paid)
| Service | Fee | Notes |
|---------|-----|-------|
| **Stripe** | **2.9% + $0.30** per domestic card payment | No monthly fee, no setup fee. $0 in months you take no payments. ([Stripe](https://stripe.com/pricing)) |

**Example:** A $5,000 AC install paid by card online → ~$147 in fees, you receive ~$4,853.

### Development / build effort
This is a real, multi-phase build (not a quick tweak). The work happens here in our sessions — each phase is built, tested, and deployed before moving on. You're not paying a developer hourly or signing a contract; you're using your existing setup, and the work is done incrementally with your review at each step.

---

## What You'd Keep vs. Replace

| Now (prototype) | After (production) |
|-----------------|--------------------|
| Data lost on rebuild | Permanent database |
| No login — one shared view | Each person logs in |
| No payments | Online card payments |
| pplx.app sandbox URL | Your own domain |
| Phone = tiny browser tab | Phone = installable app |

**What stays the same:** the entire app you already have — every page, every button, the Crown Care flow, the quote builder, all of it. We're upgrading the *foundation underneath*, not rebuilding the app.

---

## What I'd Need From You to Start (Phase 1)

1. **A Supabase account** — free to create at supabase.com (I'll walk you through it)
2. **A hosting choice** — Railway (simplest) or Vercel — I can connect either
3. **Decision on a domain** — use a free subdomain or buy a custom one

That's it for Phase 1. Phases 2–4 each need one more small signup (Supabase Auth is already included; Stripe needs an account you can create when we get there).

---

## Honest Timeline

- **Phase 1 (database + hosting):** A few focused sessions — the biggest step, since it's the foundation.
- **Phase 2 (login):** Quick — Supabase Auth is built-in and well-supported.
- **Phase 3 (payments):** Moderate — Stripe integration + invoice flow.
- **Phase 4 (mobile):** Quick — mostly PWA config + layout tuning.

You're never locked in. The code is yours, it's a standard stack, and you can take it to any developer or platform at any point.
