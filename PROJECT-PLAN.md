# OcoaBay — Master Plan & Outstanding Work

Two tracks: **A) the website + booking/commerce/AI platform** (built, tested, on staging) and
**B) Odoo HR — biometric attendance + payroll** (cloud side built, needs Odoo + hardware).
Legend: **[YOU]** = needs your action/credentials/content · **[ME]** = I build it (no secrets needed) · **[BLOCKED]** = waiting on a [YOU] item.

---

## ✅ DONE & DEPLOYED (staging: ocoabay-clone.pages.dev)

**Website / SEO**
- 1:1 bilingual clone (EN/ES), nav/links repaired site-wide (67/67 links OK), SEO canonicals/sitemaps/hreflang preserved, `noindex` guard on staging.

**Booking engine**
- Services: Wine Tour ($65), Full Experience ($145), Club House (by consumption); Thu–Sun; sessions 18 seats; Club House 100/day.
- Atomic no-double-booking, holds (15-min TTL), lifecycle states, 72h-reschedule / no-refund policy, lead-time.
- **Club House coupling** — tours also consume the 100/day pool; availability capped accordingly (tested).
- Pricing: ITBIS 18% + Propina Legal 10% as separate lines (server-authoritative).
- Booking UI: modern **burgundy + Barlow** brand, month-grid calendar, service picker, service-specific dropdowns, embedded on experience pages, on `/book/` + `/reservation/` + `/reservacion/`.
- **CS-agent booking tool** in /admin (check availability → book → email Stripe payment link).
- Admin: bookings, availability (block/open), conversations (handoff), CSV export.

**Commerce, AI, channels, automation** (all gated on keys, code complete)
- Store (catalog/cart/checkout), Stripe (Payment Element + Checkout links), Resend emails.
- AI agent (Anthropic) + web chat + WhatsApp/Instagram/email adapters; KB (12 docs); CS transcript → CS@ocoabay.com.
- Lifecycle crons: slot top-up, holds-sweeper, reminders + thank-you, CS digest.

**Odoo attendance (cloud side)**
- ZKTeco Push/ADMS receiver `/iclock/cdata`, dedupe (Neon), Odoo JSON-RPC client, replay cron, simulator — tested with no hardware.

**QA:** ~38 end-to-end checks pass, 2 bugs fixed (admin currency-500, hold lead-time). DB clean.

---

## TRACK A — Website / Booking go-live

| # | Item | Owner | Notes |
|---|---|---|---|
| A1 | **Rotate Neon DB password** | YOU | It surfaced in a library error earlier; reset in Neon → update `DATABASE_URL` (Cloudflare + `.dev.vars`). |
| A2 | **Set production secrets** in Cloudflare Pages | YOU | `ADMIN_TOKEN`, `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`+`EMAIL_FROM`. Names in `.env.example`. |
| A3 | **Create Stripe webhook** → `/api/stripe-webhook` (event `payment_intent.succeeded`) | YOU | Then put its secret in A2. |
| A4 | **Full Experience 3-course menu** dishes (EN/ES) | YOU | Replaces placeholder in the confirmation email. |
| A5 | Verify Stripe test-card booking + emails on staging | ME | After A2/A3 — I run the live card flow before cutover. |
| A6 | (Optional) Show all-in price in marketing body copy | ME | Widget already shows it; body text still says "+taxes*". |
| A7 | **Cron scheduler** | DONE/YOU | ✅ Cloudflare Cron Worker `ocoabay-cron` deployed (4 schedules). **Activate:** `cd cron-worker && npx wrangler secret put ADMIN_TOKEN` (same value as A2). After DNS, change `TARGET_BASE` in `cron-worker/wrangler.toml` to `https://ocoabay.com` + redeploy. |
| A8 | **Attach custom domain + DNS cutover** to ocoabay.com | YOU | Steps in `CUTOVER.md`; `noindex` self-lifts on the real domain. |
| A9 | Post-cutover verification | ME | Per `CUTOVER.md` checklist. |

**Optional (turn on when ready):** AI chat (`ANTHROPIC_API_KEY`), WhatsApp/Instagram (Meta creds + webhooks), inbound email (`POSTMARK_INBOUND_TOKEN`).

---

## TRACK B — Odoo HR: attendance + payroll

| # | Item | Owner | Notes |
|---|---|---|---|
| B1 | **Provision Odoo.sh — Enterprise** | YOU | Payroll is Enterprise-only. Install Employees, Attendances, Contracts, Payroll, Accounting. |
| B2 | **Generate Odoo API key** + set `ODOO_*` env vars | YOU | `.env.example` has the names. |
| B3 | **Buy ZKTeco Push terminal** (WiFi/LAN, ADMS over HTTPS) | YOU | Recommended: SpeedFace-V5L. Spec in `ODOO-ATTENDANCE.md`. |
| B4 | Create employees in Odoo; put device user-id in `barcode` | YOU | Mapping field = `ODOO_EMP_MATCH_FIELD`. |
| B5 | Configure device → Cloud/ADMS → `ocoabay.com` :443 HTTPS `/iclock/` + add SN to `DEVICE_SERIALS` | YOU | Device then pushes automatically. |
| B6 | Verify live punches → `hr.attendance`; replay backfill | ME | After B1–B5. |
| B7 | **DR payroll salary rules** (TSS, ISR, regalía, overtime, vacaciones) | ME | ✅ Design done in `ODOO-PAYROLL-DR.md` (rules, ISR brackets, parameters). Wire into Odoo once B1–B2 done; confirm rates with accountant. |
| B8 | **Invoicing automation** (store/booking → `account.move`) | ME | The "later" item you flagged; scope after B1. |

---

## What I can build NOW (no secrets) — pick any
1. **DR payroll salary-rule design** (B7) — spec the TSS/ISR/regalía rules so they're ready to drop into Odoo.
2. **All-in marketing price copy** (A6).
3. **Cron scheduler config** (A7) — exact Cloudflare Cron setup doc.
4. **Odoo CRM sync** (the original idea) — push customers/reservations/orders into Odoo CRM/Sales (two-way) once `ODOO_*` is set; I can build it gated.

## Recommended go-live order
**A1 → A2 → A3 → A5 (verify) → A7 → A8 → A9.** Track B runs in parallel (B1–B5 are procurement/config; B6–B8 follow).

---

## Blocking summary (shortest path to live store + bookings)
You do **A1 + A2 + A3** (rotate DB, add Stripe/Resend/ADMIN secrets, create webhook). I verify (A5). You flip DNS (A8). That's it — everything else is already built.
