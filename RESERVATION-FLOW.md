# OcoaBay — Reservation & Booking System: End-to-End Process, Flow & Test Guide

**Audience:** technical reviewer assessing how the reservation/booking process works and testing it.
**Scope:** the full booking lifecycle — availability, holds, reservations, payment, cancellation/reschedule, CS-agent bookings, lifecycle automation, and the AI/omnichannel layer that feeds it.
**Stack:** Cloudflare Pages + Pages Functions (serverless `/api/*`), Neon Postgres (`@neondatabase/serverless`, HTTP driver), Stripe (hosted), Resend (email), bilingual EN/ES frontend. Money is integer **cents**; times are `timestamptz`; venue timezone is **America/Santo_Domingo (UTC−4, no DST)**.

---

## 1. Business model encoded

Three bookable services (rows in `services`, configured by data, served by one engine):

| Service | slug | Capacity unit | Sessions (DR time) | Price | Tax/charge | Payment | Days |
|---|---|---|---|---|---|---|---|
| Wine Tour Experience | `wine-tour` | **18 seats / session** | 10:30, 14:00, 16:00 | **$65 pp** | 18% ITBIS + 10% Propina | full prepay | Thu–Sun |
| OcoaBay Full Experience | `full-experience` | **18 seats / session** (independent of Wine Tour) | 14:00, 16:00 | **$145 pp** | 18% ITBIS + 10% Propina | full prepay | Thu–Sun |
| OcoaBay Club House | `club-house` | **100 covers / day** (no time slot) | day (11:00–18:30) | by consumption (à la carte) | 18% ITBIS + 10% Propina (on-site) | none online | Thu–Sun |

**Tax model (critical):** two **separate** lines — **ITBIS 18%** (government VAT) and **Propina Legal 10%** (mandatory legal service charge, DR Labor Code Art. 228, goes to staff, **dine-in only**). Stored per service as `config.tax_bps=1800` and `config.service_charge_bps=1000`. The retail store (separate) charges ITBIS only.

**Policy:** **no refunds, ever.** Reschedule allowed **only > 72h** before the reservation. Encoded in `services.capacity_rules` (`reschedule_cutoff_h=72`, `refundable=false`) and enforced server-side.

**Lead time:** holds/bookings must be > **120 min** before start (`capacity_rules.lead_time_min`).

---

## 2. Data model (Neon)

```
services(id, slug, type, name_en, name_es, pricing_model, base_price_cents,
         deposit_bps, capacity_rules jsonb, config jsonb)
service_options(id, service_id, key, name_en/es, kind, price_cents, per_guest)

availability_slots(id uuid, service_id, starts_at, ends_at, label,
         capacity, booked, held, status,  UNIQUE(service_id, starts_at, label))
   -- one row per (service, date, time). booked = confirmed seats, held = in-flight.

holds(id uuid, slot_id, qty, expires_at, reservation_id, created_at)
   -- short-lived capacity reservation during checkout (15-min TTL).

reservations(id uuid, created_at, customer_id, service_id, slot_id,
         state, party_size, details jsonb, language,
         subtotal_cents, tax_cents, service_charge_cents, total_cents, deposit_cents,
         source, reminded_at,
         -- legacy columns kept for back-compat: experience, name, email, phone,
         --   arrival_date, people, message, status, raw)
reservation_events(id, reservation_id, at, from_state, to_state, actor, meta)  -- full audit trail

payments(id uuid, reservation_id, order_id, kind, amount_cents, currency, status,
         stripe_payment_intent, idempotency_key, due_at, paid_at)

customers(id uuid, email UNIQUE, name, phone, country, language, marketing_consent, ...)
```
(AI/omnichannel: `conversations`, `messages`, `agent_runs`, `kb_documents` — see §9.)

---

## 3. Reservation state machine

```
        hold (holds table, 15-min TTL)
          │  POST /api/booking/confirm  (atomically converts held→booked)
          ▼
  ┌──────────────────┐  payment succeeds (webhook)   ┌───────────┐  slot end passes (cron)  ┌───────────┐
  │ pending_payment  │ ────────────────────────────▶ │ confirmed │ ───────────────────────▶ │ completed │
  └──────────────────┘                                └───────────┘                           └───────────┘
          │                                                 │
   no payment in 60m (Stripe)                          cancel / reschedule
   → sweeper                                                │
          ▼                                                 ▼
      ┌─────────┐                                   ┌───────────┐   (reschedule keeps state,
      │ expired │                                   │ cancelled │    moves slot_id, logs event)
      └─────────┘                                   └───────────┘
```
- **Club House** (`payment:none`) skips `pending_payment` → goes straight to **confirmed** at confirm.
- Every transition writes a `reservation_events` row (`from_state`, `to_state`, `actor` = web|cs|stripe|cron|customer|admin).

---

## 4. The no-double-booking guarantee (core mechanism)

The whole system rests on **one atomic SQL statement** at hold time (works within Neon's HTTP driver — no interactive transaction needed):

```sql
update availability_slots
   set held = held + :qty
 where id = :slot_id and status = 'open' and starts_at > now()
   and booked + held + :qty <= capacity
returning id;
```
Postgres row-level atomicity means concurrent requests **cannot oversubscribe** — only the requests that keep `booked + held + qty <= capacity` get a row back; the rest get 0 rows → `409 Slot unavailable`. Then a `holds` row is inserted with a 15-minute `expires_at`.

- **confirm** converts: `booked += qty, held -= qty`, deletes the hold (seat now reserved).
- **expiry** (cron `holds-sweeper`): releases `held` for expired holds; expires stale unpaid Stripe reservations (>60 min) releasing `booked`.
- **cancel/reschedule/admin-cancel**: release or move `booked`.
- (Scale note: if a single slot ever became a write hotspot, it can be fronted by a Cloudflare Durable Object; not needed at these volumes.)

---

## 5. END-TO-END FLOWS

### 5A. Customer self-service booking (web)
Entry points: `/book/?service=<slug>&lang=<en|es>` **and** the experience pages
(`/wine-tour-tasting/`, `/tour-de-vinos-cata/`, `/full-ocoabay-experience/`, `/experiencia-completa/`)
which **embed the same widget** (via `reservation-form.js`, asset-only, no page edits).

```
1. Widget loads → GET /api/booking/availability?service=…   (slots with remaining = capacity−booked−held)
2. Customer picks Date → Session → party size (≤ remaining)
3. Fills service-specific details (dropdowns: tour language, dietary, occasion,
   seating/arrival for Club House, per-guest main course for Full Experience) + name/email/phone
4. Submit:
     POST /api/booking/hold      {slot_id, qty}                 → {hold_id, expires_at}   (atomic, §4)
     POST /api/booking/confirm   {hold_id, name, email, phone, language, details}
5. confirm:
     - reserves seat (booked+=qty, held-=qty, delete hold), upserts customer, inserts reservation,
       writes reservation_events.
     - Club House  → state=confirmed, sends confirmation email, returns {payment:"none"}.
     - Prepaid + Stripe keys → state=pending_payment, creates Stripe PaymentIntent,
       returns {payment:"stripe", client_secret} → widget mounts Stripe Payment Element →
       customer pays → Stripe webhook → state=confirmed + confirmation email.
     - Prepaid + no Stripe → state=pending_payment, returns {payment:"arrange"} +
       "we'll contact you to arrange payment" email.
```
All strings, dropdowns, emails are EN/ES (language carried from the URL/path).

### 5B. CS-agent assisted booking (admin → "New Booking")
For a staff agent handling a customer by phone/WhatsApp:
```
1. Agent: pick Service → Date → Session (live remaining), enter customer + party size + details.
2. "Check availability & send payment link" →
     POST /api/admin {action:"cs_booking", service, slot_id, name, email, phone, party_size, language, details}
3. Server: atomically reserves seat, creates reservation (source="cs"), creates payment row, then:
     - Stripe keys present → creates a Stripe CHECKOUT SESSION (hosted page) and EMAILS the customer
       a bilingual payment link (itemised ITBIS+Propina+total); returns the URL to the agent too.
     - Club House → confirmed immediately (pay on-site), confirmation email.
     - No Stripe → "arrange payment" email.
4. Customer clicks the link → pays on Stripe's hosted page → webhook (metadata.reservation_id)
   → reservation confirmed + confirmation email.
```

### 5C. Payment + webhook (shared by store & bookings)
- **Web**: Stripe **Payment Element** (PaymentIntent, `client_secret`). **CS/email**: Stripe **Checkout Session** (hosted URL).
- Both carry `metadata.reservation_id`. `POST /api/stripe-webhook` verifies the HMAC signature (`STRIPE_WEBHOOK_SECRET`), and on `payment_intent.succeeded`:
  - booking → `reservations.state='confirmed'`, `payments.status='paid'`, confirmation email, audit event.
  - store order → `orders.status='processing'`, receipt email.
- **Idempotent**: status-guarded updates + `payments.idempotency_key` unique. PCI scope = **SAQ-A** (no card data touches our servers).

### 5D. Cancellation / reschedule (policy-enforced)
- `POST /api/booking/cancel {reservation_id, email}` → verifies email owns it, sets `cancelled`, frees the seat, **no refund** (returned + logged).
- `POST /api/booking/reschedule {reservation_id, email, new_slot_id}` → **rejected if ≤72h** before current start; else atomically reserves the new slot, frees the old, updates `slot_id`, logs `rescheduled`.

### 5E. Lifecycle automation (cron jobs, `Authorization: Bearer ADMIN_TOKEN`)
| Cron | Does |
|---|---|
| `/api/cron/generate-slots` | Tops up `availability_slots` 60 days ahead (Thu–Sun) so availability never runs dry. Idempotent. |
| `/api/cron/holds-sweeper` | Releases expired holds; expires stale unpaid Stripe reservations (>60m), freeing seats. |
| `/api/cron/reminders` | 48h-before reminder email (once, `reminded_at`); auto-completes past bookings → thank-you/review email. |
| `/api/cron/cs-digest` | Emails EVERY conversation transcript to **CS@ocoabay.com** (bilingual) once idle 30m, then closes it. |
| `/api/cron/abandoned` | Store abandoned-cart reminder (pre-existing). |

### 5F. AI agent & omnichannel (feeds bookings)
- Web chat widget (site-wide), **WhatsApp**, **Instagram**, **inbound email** → one orchestrator (`/api/agent`, `_lib/agent.js`) on the **Anthropic API**, grounded in a 12-doc bilingual knowledge base (`kb_documents`).
- The agent uses **tools** (the only way it touches data): `check_availability`, `get_pricing`, `get_booking_link`, `lookup_reservation`, `save_lead`, `escalate_to_human`. It never invents prices/availability; it shares booking links and escalates complex cases to a human.
- Every conversation is transcripted to **CS@ocoabay.com** (handoff = instant; others via the idle digest), bilingual.

---

## 6. API reference (booking)

| Method · Path | Body / Query | Returns |
|---|---|---|
| GET `/api/booking/availability` | `?service=&from=&to=` | service + slots `[{slot_id, starts_at, label, remaining}]` |
| POST `/api/booking/quote` | `{service, party_size, options?}` | itemised `{subtotal, tax(ITBIS), service_charge(Propina), total}` |
| POST `/api/booking/hold` | `{slot_id, qty}` | `{hold_id, expires_at}` or `409` |
| POST `/api/booking/confirm` | `{hold_id, name, email, phone?, language?, details?}` | `{reservation_id, state, payment, client_secret?}` |
| POST `/api/booking/cancel` | `{reservation_id, email}` | `{state:"cancelled", refund:false}` |
| POST `/api/booking/reschedule` | `{reservation_id, email, new_slot_id}` | `{new_starts_at}` or `409` |
| POST `/api/stripe-webhook` | Stripe event (signed) | confirms booking/order |
| POST `/api/admin` (Bearer) | `{action:"cs_booking" \| "booking_state" \| "block_slot" \| "open_slot" \| ...}` | varies |
| GET `/api/admin?view=` (Bearer) | `bookings \| availability \| conversations \| export` | admin data |

---

## 7. Pricing — worked examples (server-authoritative; client never sends amounts)

`total = base_price_cents × party_size + Σoptions`, then `+ ITBIS(18%) + Propina(10%)`.

| Booking | Subtotal | ITBIS 18% | Propina 10% | **Total** |
|---|---|---|---|---|
| Wine Tour × 2 | $130.00 | $23.40 | $13.00 | **$166.40** |
| Full Experience × 2 | $290.00 | $52.20 | $29.00 | **$371.20** |
| Wine Tour × 3 | $195.00 | $35.10 | $19.50 | **$249.60** |
| Club House × N | by consumption | — | — | **$0 online** (pay on-site) |

---

## 8. Admin / back-office (`/admin/`, token-gated, `noindex`)
Tabs: **Orders** · **Bookings** (state management; cancel frees the seat) · **Availability** (block/open any slot) · **Conversations** (human-handoff queue + thread view + close) · **New Booking** (the CS tool, §5B) · **Reservations** (legacy form submissions) · **Export** (CSV: customers / reservations / orders for CRM).

---

## 9. What is LIVE vs GATED (needs a key)

| Capability | Status |
|---|---|
| Availability, holds, quote, confirm, cancel, reschedule | **Live & verified** |
| Capacity / no-double-booking | **Live & verified** |
| Booking UI (web + experience pages), EN/ES, accessible | **Live & verified** |
| CS-agent booking tool (reserve + create) | **Live & verified** |
| Admin board (bookings/availability/conversations/export) | **Live & verified** |
| Card payment (Payment Element + Checkout link) | Code live; **needs `STRIPE_*` keys** to charge (falls back to "arrange payment") |
| Emails (confirmation, reminder, thank-you, payment link, CS transcript) | Code live; **needs `RESEND_API_KEY`** (otherwise no-op/logged) |
| AI agent replies (web/WhatsApp/IG/email) | Code live; **needs `ANTHROPIC_API_KEY`** (+ Meta creds for WA/IG) — offline fallback until then |
| Crons | Endpoints live; **need a scheduler** calling them with `ADMIN_TOKEN` |

Hosting note: served at `ocoabay-clone.pages.dev` (with a `noindex` guard); production cutover to `ocoabay.com` is documented in `CUTOVER.md`.

---

## 10. TEST PLAN (for the reviewer)

Base URL: `https://ocoabay-clone.pages.dev`. Use a browser **User-Agent** header for API calls (Cloudflare blocks default bot UAs). Examples below are copy-paste `curl`/JSON.

### T1 — Availability
```
GET /api/booking/availability?service=wine-tour
Expect: 200, slots[] each {slot_id, starts_at, label∈{10:30,14:00,16:00}, remaining≤18}, Thu–Sun only.
GET …?service=full-experience  → labels {14:00,16:00}, remaining≤18 (independent counter).
GET …?service=club-house       → one slot/day, label "clubhouse-day", remaining≤100.
```

### T2 — Pricing (server-authoritative)
```
POST /api/booking/quote {"service":"wine-tour","party_size":2}
Expect: subtotal_cents=13000, tax_cents=2340, service_charge_cents=1300, total_cents=16640.
POST … {"service":"full-experience","party_size":2} → 29000 / 5220 / 2900 / 37120.
POST … {"service":"club-house","party_size":4}     → note: à la carte, no fixed price.
```

### T3 — Happy-path booking (Club House = no payment)
```
GET availability club-house → take a slot_id
POST /api/booking/hold    {"slot_id":"…","qty":4}        → {hold_id}
POST /api/booking/confirm {"hold_id":"…","name":"Test","email":"you@example.com","language":"en"}
Expect: {state:"confirmed", payment:"none"}.  Re-GET availability → remaining dropped by 4.
```

### T4 — Prepaid booking (Wine Tour / Full Experience)
```
hold → confirm (as above).
Without Stripe keys: {state:"pending_payment", payment:"arrange"}.
With Stripe test keys: {payment:"stripe", client_secret} → pay with test card 4242 4242 4242 4242
   → webhook → state becomes "confirmed" (check Bookings tab / DB).
```

### T5 — No double-booking (concurrency)
```
Find a slot with remaining = R. Fire R+2 simultaneous holds of qty 1.
Expect: exactly R succeed (200), the rest 409 "Slot unavailable". booked+held never exceeds capacity.
```

### T6 — Reschedule policy (72h gate)
```
Book a slot < 72h away → POST /api/booking/reschedule → 409 "only allowed more than 72h before".
Book a slot > 72h away → reschedule to another open slot → 200 {new_starts_at}; old seat freed, new seat taken.
```

### T7 — Cancellation (no refund)
```
POST /api/booking/cancel {reservation_id, email} → {state:"cancelled", refund:false}; seat freed.
Wrong email → 403.
```

### T8 — CS-agent booking (admin; needs ADMIN_TOKEN)
```
POST /api/admin  (Bearer ADMIN_TOKEN)
  {"action":"cs_booking","service":"wine-tour","slot_id":"…","name":"Cust","email":"c@x.com",
   "party_size":3,"language":"es","details":{"dietary":"Vegetarian","occasion":"Birthday"}}
Expect: {ok:true, state, payment}; with Stripe → {payment:"stripe", payment_url} + email sent to customer.
Reservation appears in admin "Bookings" with source=cs and details captured.
```

### T9 — Lifecycle crons (Bearer ADMIN_TOKEN)
```
POST /api/cron/holds-sweeper   → releases expired holds.
POST /api/cron/generate-slots  → tops up future slots (idempotent).
POST /api/cron/reminders       → 48h reminders + auto-complete + thank-you.
POST /api/cron/cs-digest       → emails idle conversation transcripts to CS@ocoabay.com.
(Without ADMIN_TOKEN → 401.)
```

### T10 — UI / accessibility / bilingual
```
Open /book/?service=full-experience&lang=es → Spanish UI, date/session pickers, per-guest
   "Plato fuerte" selectors, ITBIS+Propina shown separately.
Open /wine-tour-tasting/ (EN) and /experiencia-completa/ (ES) → booking widget embedded inline.
Tab through fields → labels are associated (accessible).
```

**Verified results on file (sample):** quote exactness (T2 numbers), capacity decrement, 72h gate (rejects <72h, allows >72h), cancel frees seat, CS booking `source=cs` total $249.60 with details, all cron/admin endpoints `401` without token. Test data is cleared after each run.

---

## 11. Edge cases & safeguards
- **Hold expiry**: 15-min TTL; sweeper reclaims. Stale unpaid Stripe reservations expire at 60 min.
- **Lead-time**: holds rejected ≤120 min before start.
- **Email mismatch** on cancel/reschedule → 403.
- **Timezone**: slots stored at `-04:00`; dates derived via `toISOString().slice(0,10)` (validated for the 10:30/14:00/16:00/11:00 times).
- **Webhook**: HMAC-verified, status-guarded, idempotent.
- **Pricing**: always recomputed server-side; client amounts ignored.
- **Audit**: every state change in `reservation_events`.

## 12. Known limitations / recommendations for the reviewer to weigh
1. **Deposits**: schema supports `deposit_bps`, but current policy is **full prepay** (deposit not used). Easy to switch on per service.
2. **Full Experience capacity vs Club House**: tour seats (18) and Club House covers (100) are tracked independently; a Full Experience guest also uses the Club House but does **not** currently decrement the 100/day pool. Confirm if that coupling is desired.
3. **Per-guest menu** is captured but the actual 3-course dish list is a placeholder pending content.
4. **Reschedule** keeps the reservation's functional state and only moves the slot (logged as `rescheduled`) — confirm if a distinct state is wanted.
5. **No-refund** is absolute in code; if partial refunds are ever desired, Stripe Refunds API + policy windows would be added.
6. **Crons** require an external scheduler (Cloudflare Cron Worker / any cron) hitting the endpoints with `ADMIN_TOKEN`.
7. **Abandoned/stale pending bookings** without Stripe (the "arrange payment" path) are left for staff (not auto-expired) — confirm desired handling.

---

*Source of truth in the repo: `functions/api/booking/*`, `functions/_lib/booking.js`, `functions/api/admin.js`, `functions/api/cron/*`, `public/assets/booking.js`, `db/booking-schema.sql` / `db/booking-seed.sql` / `db/generate-slots.mjs`. Companion docs: `IMPLEMENTATION-PLAN.md`, `PHASE-1-SPEC.md`, `CUTOVER.md`.*
