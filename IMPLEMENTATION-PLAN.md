# OcoaBay (Expanded) — Implementation Plan
### Booking, Reservations, Payments & AI Customer-Service Platform

**Subject:** OcoaBay, expanded — adds Restaurant, Weddings, Corporate Events, Buffet/Catering as new bookable services on top of the existing Wine store, Experiences, and Reservations.
**Foundation:** builds directly on the stack already live in this repo (Cloudflare Pages + Pages Functions, Neon Postgres, Stripe, Resend, bilingual EN/ES static frontend, token-gated admin).
**Status:** implementation plan derived from the Phase-0 discovery brief. Sequenced so nothing in later phases is built on an untrustworthy core.

> This plan is concrete and stack-specific. SQL, endpoint signatures, and component choices are written against what exists in `functions/`, `db/`, and `public/` today.

---

## 1. What we already have (reuse, don't rebuild)

| Capability | Today | Reused for |
|---|---|---|
| Hosting/runtime | Cloudflare Pages + Functions (`functions/api/*`) | All new APIs are Pages Functions |
| Database | Neon Postgres via `@neondatabase/serverless` (tagged-template `sql\`\``) | Unified data model |
| Payments | Stripe wired & gated — `/api/payment` (PaymentIntent, self-migrating column), `/api/stripe-webhook` (HMAC-verified, status-guarded) | Extend to deposits/balances |
| Email | Resend wired & gated — `_lib/email.js` (`sendEmail`, `sendOrderEmail`) | Lifecycle automation |
| Pricing | `_lib/pricing.js` — server-authoritative, coupons, shipping, tax, `normalizeCountry()` | Per-service pricing engine |
| Auth | `_lib/auth.js` — PBKDF2 + cookie sessions, `getSessionCustomer` | Customer accounts |
| Reservations | `/api/reservation` + `reservations` table + admin tab | Becomes one service type in the engine |
| Store | `products`, `orders`, `carts`, coupons, invoice | Stays as-is (retail) |
| Admin | `public/admin/` token-gated, Orders + Reservations | Extended with bookings/availability |
| Async | Cron Trigger `functions/api/cron/abandoned.js` | Pattern for reminders/sweepers |
| Frontend | Bilingual static mirror, `noindex` cutover guard, SEO 1:1 | Booking UIs + chat widget |

**Net:** the reservation/payment/data/email scaffolding exists. This plan generalises it from "single reservation form" to a **configurable multi-service reservation engine** and adds the **AI + omnichannel** layer.

---

## 2. Target architecture (extends current stack)

```
                         ┌────────────────────────── Cloudflare ──────────────────────────┐
 Web (chat widget,       │                                                                 │
 booking UIs) ───────────┤  Pages (static EN/ES)  +  Pages Functions (/api/*)              │
 WhatsApp (Meta) ────────┤        │                         │                              │
 Instagram (Meta) ───────┤  Channel adapters ──▶ Conversation Orchestrator ──▶ Anthropic   │
 Email (inbound) ────────┤  /api/channels/*        /api/agent (tool-use loop)   Messages API│
                         │                              │     │                            │
                         │   Reservation core  ◀────────┘     └──▶ RAG retrieval           │
                         │   /api/booking/*                         (pgvector in Neon)      │
                         │   Durable Object: SlotHold                                       │
                         │        │                                                         │
                         │   Payment service /api/payment/* (Stripe hosted)                 │
                         │   Queues (outbound msgs, embeddings)  Cron (reminders, sweeper)  │
                         └───────────────────────────────┬─────────────────────────────────┘
                                                         │
                                              Neon Postgres (system of record)
                                              + pgvector (knowledge base)
                                                         │
                                              CRM (integrated, Phase 5)  ◀── sync worker
```

### New infrastructure components
| Component | Choice | Why |
|---|---|---|
| Concurrency / slot holds | **Durable Objects** (one per slot) *or* Postgres atomic conditional `UPDATE` | DO gives serialized per-slot writes; the SQL primitive (below) avoids new infra. Start with SQL; add DO only if a slot becomes a hotspot. |
| Vector / RAG | **pgvector in Neon** | Single source of truth; no second datastore. Retrieval is plain SQL. |
| Embeddings | **Voyage AI** (Anthropic-recommended) or Cloudflare Workers AI `bge` | Anthropic has no embeddings endpoint; Voyage pairs well with Claude. |
| Agent LLM | **Anthropic Messages API** (`claude-*`) with tool use | Per brief §20; tools = the only way it touches data. |
| Async work | **Cloudflare Queues** | Decouple outbound channel sends + embedding jobs from request path. |
| Scheduled work | **Cron Triggers** (extend existing) | Hold expiry sweeper, reminders, balance-due chasers. |
| WhatsApp / IG | **Meta Cloud API** (WhatsApp Business + Instagram Messaging) | Official, webhook-based. |
| Inbound email | **Cloudflare Email Routing → Worker** or Postmark inbound | Feed the same orchestrator. |

---

## 3. Unified data model (Neon DDL)

New tables (additive; existing `products/orders/carts/submissions/reservations` stay). Money in integer cents. All times `timestamptz`.

```sql
-- ---------- People ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text, phone text,
  first_name text, last_name text,
  country text, language text default 'en',          -- 'en' | 'es'
  preferred_channel text,                            -- web|whatsapp|instagram|email
  password_hash text,                                -- existing auth reuse (nullable = lead)
  marketing_consent boolean default false,
  notes text,
  unique (email)
);

-- ---------- Service catalogue ----------
create table if not exists services (
  id serial primary key,
  slug text unique not null,                          -- restaurant, wedding, corp-event, buffet, tour-wine, experience-*
  type text not null,                                 -- restaurant|wedding|event|buffet|tour|experience
  name_en text, name_es text,
  active boolean default true,
  pricing_model text not null,                        -- fixed|per_guest|package|quote
  base_price_cents int default 0,
  deposit_bps int default 0,                          -- 2500 = 25% deposit; 0 = no deposit
  capacity_rules jsonb default '{}',                  -- {venue_cap, per_slot_cap, lead_time_min, cutoff_min}
  config jsonb default '{}'                           -- per-service capture schema + workflow flags
);

create table if not exists service_options (         -- packages & add-ons (photography, drone, menu, seating…)
  id serial primary key,
  service_id int references services(id),
  key text, name_en text, name_es text,
  kind text,                                          -- package|addon|menu|variant
  price_cents int default 0, per_guest boolean default false,
  meta jsonb default '{}'
);

-- ---------- Availability (the bookable inventory) ----------
create table if not exists availability_slots (
  id uuid primary key default gen_random_uuid(),
  service_id int references services(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  label text,                                         -- 'Morning 10:30–12:30', table id, date…
  capacity int not null,                              -- units: covers / seats / session places / 1 for date-exclusive
  booked int not null default 0,                      -- confirmed consumption
  held int not null default 0,                        -- in-flight holds
  status text not null default 'open',                -- open|closed|blocked
  unique (service_id, starts_at, label)
);
create index if not exists slots_service_time on availability_slots (service_id, starts_at);

-- ---------- Holds (short-lived reservation of capacity during checkout) ----------
create table if not exists holds (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references availability_slots(id),
  qty int not null,
  expires_at timestamptz not null,                    -- now() + 15 min
  reservation_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists holds_expiry on holds (expires_at);

-- ---------- Reservations (lifecycle) ----------
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_id uuid references customers(id),
  service_id int references services(id),
  slot_id uuid references availability_slots(id),
  state text not null default 'enquiry',              -- enquiry|held|pending_payment|confirmed|completed|cancelled|expired|rescheduled
  party_size int,
  details jsonb default '{}',                          -- captured fields per service (names, dietary, packages…)
  language text default 'en',
  total_cents int default 0, deposit_cents int default 0,
  source text default 'web',                           -- web|whatsapp|instagram|email|admin
  -- NB: legacy reservation columns (experience,name,email,arrival_date,people,message) kept for back-compat;
  --     new bookings populate customer_id/service_id/slot_id/details.
  raw jsonb
);
create index if not exists resv_state on reservations (state, created_at desc);

create table if not exists reservation_events (       -- audit trail of every state transition
  id bigserial primary key,
  reservation_id uuid references reservations(id),
  at timestamptz not null default now(),
  from_state text, to_state text, actor text, meta jsonb
);

-- ---------- Payments (deposit / full / scheduled balances) ----------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reservation_id uuid references reservations(id),
  order_id uuid,                                       -- for retail store orders
  kind text not null,                                 -- deposit|full|balance
  amount_cents int not null, currency text default 'USD',
  status text not null default 'pending',             -- pending|paid|failed|refunded
  stripe_payment_intent text, idempotency_key text unique,
  due_at timestamptz, paid_at timestamptz
);

-- ---------- Conversations (omnichannel) ----------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_id uuid references customers(id),
  channel text not null,                              -- web|whatsapp|instagram|email
  external_id text,                                   -- WA phone / IG thread / email thread id
  language text default 'en',
  status text not null default 'open',                -- open|handoff|closed
  assigned_to text,
  unique (channel, external_id)
);
create table if not exists messages (
  id bigserial primary key,
  conversation_id uuid references conversations(id),
  at timestamptz not null default now(),
  role text not null,                                 -- user|assistant|tool|agent_human
  content text, tool_name text, tool_payload jsonb
);

-- ---------- CRM-lite: notes / tasks / consent ----------
create table if not exists notes (id bigserial primary key, customer_id uuid, body text, author text, at timestamptz default now());
create table if not exists tasks (id bigserial primary key, customer_id uuid, title text, due_at timestamptz, done boolean default false);
create table if not exists consent_events (id bigserial primary key, customer_id uuid, kind text, granted boolean, source text, at timestamptz default now());

-- ---------- Knowledge base (RAG) ----------
create extension if not exists vector;
create table if not exists kb_documents (
  id serial primary key, slug text unique, title text, lang text, source text,
  body text, version int default 1, updated_at timestamptz default now()
);
create table if not exists kb_chunks (
  id bigserial primary key, document_id int references kb_documents(id),
  lang text, chunk text, embedding vector(1024),      -- match the embedding model dim
  meta jsonb default '{}'
);
create index if not exists kb_chunks_vec on kb_chunks using ivfflat (embedding vector_cosine_ops);

-- ---------- Agent observability ----------
create table if not exists agent_runs (
  id bigserial primary key, conversation_id uuid, at timestamptz default now(),
  model text, input_tokens int, output_tokens int, latency_ms int,
  tools_called jsonb, escalated boolean default false, confidence text
);
```

---

## 4. Reservation & availability engine (the core)

### 4.1 The concurrency primitive (no double-booking)
The whole engine rests on **one atomic SQL statement** — a conditional `UPDATE` that only succeeds if capacity remains, and returns the row only on success:

```sql
-- create a hold atomically; returns 0 rows if the slot can't fit qty
update availability_slots
   set held = held + $qty
 where id = $slot_id
   and status = 'open'
   and booked + held + $qty <= capacity
returning id;
-- if a row is returned -> insert into holds(...) with expires_at = now() + interval '15 min'
```

Postgres guarantees row-level atomicity, so concurrent requests can't oversubscribe. **No interactive transaction needed** (important: the Neon HTTP driver runs each `sql\`\`` as its own statement). On confirm: `booked += qty`, `held -= qty` in one statement; on expiry/cancel: `held -= qty` / `booked -= qty`.

> Scale-up option: if a single slot becomes a write hotspot (e.g. a flash sale), front it with a **Durable Object** `SlotHold` that owns the counter in memory and persists to Neon — serialized writes, zero contention. Not needed at launch volumes.

### 4.2 Lifecycle state machine
`enquiry → held → pending_payment → confirmed → completed`
side transitions: `→ cancelled`, `→ expired` (hold TTL lapses), `→ rescheduled` (cancel old slot consumption, hold new). Every transition writes a `reservation_events` row (actor, from, to, meta) for audit.

### 4.3 Endpoints (`functions/api/booking/`)
| Endpoint | Purpose |
|---|---|
| `GET /api/booking/availability?service=&from=&to=` | Live remaining capacity per slot (`capacity - booked - held`), fully-booked slots disabled. |
| `POST /api/booking/hold` | Atomic hold (4.1), returns `hold_id` + `expires_at`. |
| `POST /api/booking/quote` | Server-side price (service + party_size + options); never trusts client amounts. |
| `POST /api/booking/confirm` | Hold → reservation; if deposit/full required, create PaymentIntent and go `pending_payment`; else `confirmed` (auto or hold-for-approval). |
| `POST /api/booking/cancel` / `…/reschedule` | Policy-window-gated; releases/moves capacity; audited. |
| Cron `cron/holds-sweeper` | Releases expired holds (`held -= qty`), marks reservations `expired`. |

### 4.4 Operational controls
Waiting list when full, auto-closure at capacity, manual date blocking (`status='blocked'`), configurable lead-time & cut-off (`capacity_rules`), per-service approval threshold (auto-confirm under N, else `hold-for-approval`).

---

## 5. Payment & pricing (deposits, full, balances)

Extends the existing Stripe integration:
- **Pricing engine** (`_lib/pricing.js` generalised): a per-service resolver computes amount server-side from `pricing_model` + party_size + selected `service_options`. Output feeds quote + PaymentIntent. Client amounts are never trusted (already the rule for the store).
- **Modes:** `deposit` (`deposit_bps`, e.g. 2500 = 25%), `full`, and `balance` schedules for weddings/events (rows in `payments` with `due_at`).
- **PaymentIntent** per `payments` row with an **idempotency key** (`reservation_id:kind`) to prevent duplicate charges. Reuses the hardened `/api/stripe-webhook` (HMAC-verified, status-guarded) — on `payment_intent.succeeded`, mark the `payments` row `paid`, advance the reservation (`pending_payment → confirmed`), fire confirmation email.
- **Balance chasing:** cron scans `payments where kind='balance' and status='pending' and due_at < now()+window` → reminder emails; optional saved-card auto-charge (Stripe off-session) if the client opts in.
- **PCI:** Stripe hosted Payment Element only → **SAQ-A**; no card data on Cloudflare/Neon (already true).
- **Refunds:** policy-driven via Stripe Refunds API, audited in `payments`/`reservation_events`.

---

## 6. Per-service configuration (config, not separate systems)

Each service is a `services` row + `service_options` + a capture schema in `config` (JSON). The same engine (§4) and payment service (§5) serve all. Summary of what each needs:

| Service | Capacity unit | Key capture | Pricing | Deposit | Workflow |
|---|---|---|---|---|---|
| **Restaurant** | covers per slot (~100 venue cap, table inventory) | guests, date, time slot, seating (indoor/outdoor), allergies, occasion | fixed / optional per-cover | optional / no-deposit hold | auto-confirm under cap; hold-for-approval above threshold |
| **Weddings** | date-exclusive | couple, date + backup, est. guests, photo/video/drone, hours, accom/transport | package + add-ons | **25%** + balance schedule | enquiry → consult → quote → deposit → confirmed; date provisionally held |
| **Corporate events** | date/venue | company, contact, event type, guests, run-of-show, AV/stream, budget | quote-led | deposit + full | enquiry → qualify → proposal → deposit → confirmed |
| **Buffet / catering** | date | date, location, guests, menu + dietary variants, staff/equipment | **per-guest** base + options | 25% or full | quote → deposit |
| **Tours** (3 products) | session places | session (Morning/Afternoon/Evening), language, guests, guide | per-product | deposit or full | auto-confirm on payment |
| **Experiences** (existing 8) | per-experience | (current reservation fields) | fixed/quote | optional | existing form → engine |

Tour sessions to model (validate with client): Morning 10:30–12:30; Afternoon 14:00–15:30 (lunch); Evening 16:00–17:30 (lunch). These become `availability_slots` rows generated on a recurring schedule.

---

## 7. AI customer-service agent (Anthropic)

### 7.1 Orchestrator — `POST /api/agent`
A tool-use loop against the Anthropic Messages API:
1. Load/create `conversation`; append inbound `message`.
2. RAG: embed the query, retrieve top-k `kb_chunks` (pgvector cosine, filtered by `lang`), inject into the system prompt.
3. Call Claude with the **tool definitions** below; if it returns `tool_use`, execute the tool (server-side, against the real DB), append `tool_result`, loop until a final text answer.
4. Persist assistant message + `agent_runs` (tokens, latency, tools, confidence). Return reply to the channel adapter.

### 7.2 Tools (function calling) — the only way the agent touches data
| Tool | Maps to |
|---|---|
| `check_availability(service, date_range)` | `/api/booking/availability` |
| `get_pricing(service, party_size, options)` | `/api/booking/quote` |
| `create_hold(slot_id, qty)` | `/api/booking/hold` |
| `create_payment_link(reservation_id, kind)` | Stripe Checkout/PI link |
| `lookup_reservation(email_or_id)` | reservations read |
| `upsert_lead(contact, consent)` | customers/consent_events |
| `escalate_to_human(reason)` | sets conversation `handoff`, notifies queue |

### 7.3 Grounding & guardrails
- **Never** quotes a price or confirms a booking except via tools/KB (RAG). System prompt enforces this.
- **Escalation rules:** low confidence, explicit human request, complaints, high-value (weddings/large events), repeated tool failure → `escalate_to_human` → human handoff queue (admin) + optional WhatsApp/email ping.
- **Everything logged:** transcripts (`messages`), tool calls + `agent_runs` for audit and eval.

### 7.4 Multilingual
Detect EN/ES from inbound text + customer profile; pin language across the whole thread; retrieve KB chunks in that language.

### 7.5 Knowledge base (RAG pipeline)
- `kb_documents` is the **single source of truth** for services, pricing, packages, policies, FAQs, terms, refunds (EN + ES).
- On document change: chunk → embed (Voyage/Workers AI) → upsert `kb_chunks` (Queue job). Versioned + changelog so the agent never serves stale answers.
- The same KB feeds website FAQ content (no divergent copies).

### 7.6 Observability & eval
`agent_runs` metrics (resolution rate, handoff rate, latency, token cost); a curated **eval set** of representative conversations run on every prompt/KB change before release; CSAT capture post-conversation.

---

## 8. Channel adapters (thin; intelligence stays central)

| Channel | Inbound | Outbound | Notes |
|---|---|---|---|
| **Web chat** | widget → `/api/agent` | JSON reply | Embed on all pages; bilingual. |
| **WhatsApp** | Meta webhook `/api/channels/whatsapp` (verify token + signature) → normalise → `/api/agent` | Cloud API send | **On close, email transcript** to a designated address (TBC). |
| **Instagram** | Meta webhook `/api/channels/instagram` | IG Messaging send | Same agent/KB/tools. |
| **Email** | Cloudflare Email Routing → Worker (or Postmark inbound) → `/api/channels/email` | Resend | Inbound enquiries answered by agent; lifecycle mail via §9. |

All adapters normalise to `conversations`/`messages`, so the agent is channel-agnostic. Outbound sends go through a **Queue** for retry/rate-limit safety.

---

## 9. Lifecycle email automation (Resend, EN/ES, logged)

Trigger → recipient → template, all templated + authenticated domain (SPF/DKIM/DMARC), localised, logged:

Inquiry received · Reservation confirmation · Payment confirmation · Deposit reminder · Balance-due reminder · Tour/Wedding/Event/Restaurant reminder · Cancellation · Reschedule · Thank-you · Review request · Follow-up.

Reminders + balance chasers run on **Cron Triggers** (extend the existing cron pattern). Templates live beside `_lib/email.js`.

---

## 10. CRM strategy — integrate, don't build (per brief §24)

The §3 unified data model **is** the system of record. Recommendation: **don't build a bespoke CRM early.** Phase 5 integrates a proven CRM/helpdesk (HubSpot free tier / Pipedrive) via a one-way **sync worker** (customers, reservations, payments, conversation summaries → CRM). Revisit a custom build only if off-the-shelf becomes a genuine constraint. A short build-vs-buy table (cost, time-to-value, lock-in, channel coverage, data ownership) ships with the spec.

---

## 11. Admin / back-office extensions

Extend `public/admin/` (currently Orders + Reservations):
- **Bookings** board by service + state (enquiry/held/pending/confirmed/completed), confirm/reject/modify/reschedule.
- **Availability** editor: open/close/block dates, set per-slot capacity, generate recurring tour/restaurant slots.
- **Handoff queue:** live agent conversations needing a human; reply inline (writes to `messages`, sends via the channel).
- **Customer view:** profile, reservation + payment history, notes/tasks, consent.
- **Role-based access + audit trail** (`reservation_events`, admin action log). Add **MFA** for admin (NFR).

---

## 12. Non-functional requirements (how we meet them)

| Category | Approach |
|---|---|
| Performance | Edge functions + Neon pooled; availability is indexed single-row reads; checkout PI created once. |
| Availability/DR | Graceful degradation if Stripe/Anthropic/Meta down (queue + retry); Neon PITR backups; idempotent webhooks. |
| Scalability | Stateless functions; capacity/data model are config-driven; Queues absorb spikes. |
| Security | TLS everywhere; secrets in Cloudflare encrypted env; least-privilege API scopes; **MFA on admin**; dependency scanning in CI. |
| Payment compliance | Stripe hosted → **SAQ-A**; no card data stored. |
| Data protection | Consent model (`consent_events`), DSAR export/erasure, defined retention; PII minimised. |
| Accessibility | Booking flows to **WCAG 2.2 AA**. |
| i18n | Full EN/ES UI + email + agent; locale-aware dates/times/currency. |
| Observability | Cloudflare Analytics/Logpush + `agent_runs` + booking/payment alerts. |
| Auditability | Every reservation & payment transition attributable + timestamped. |

---

## 13. Phased roadmap (dependency-ordered)

| Phase | Scope | Key deliverables | Rough effort* |
|---|---|---|---|
| **1. Reservation & payment core** | Data model (§3), engine (§4), pricing+deposits (§5), 6 services as config (§6), booking UIs | No double-booking; online booking + deposit/full for all services; confirmations | 3–5 wks |
| **2. Lifecycle automation + admin** | Emails/reminders (§9), admin bookings/availability/roles/MFA (§11) | Reduced manual ops; full back-office | 2–3 wks |
| **3. AI agent (web)** | Orchestrator + tools + RAG KB (§7), web chat widget | Automated answers + booking assistance on site | 3–4 wks |
| **4. Channel expansion** | WhatsApp + Instagram + inbound email adapters, handoff queue (§8) | One agent across all channels; transcript-on-close | 3–4 wks |
| **5. CRM & analytics** | CRM integration + sync, reporting dashboards (§10) | Single customer view + insight | 2–3 wks |

\* Indicative engineering effort, single experienced full-stack dev; parallelisable. Firmed up after the open questions (§15) are answered.

**Critical path:** Phase 1 is the trust anchor — phases 2–5 are not meaningful without a correct, concurrency-safe core. Start **Meta (WhatsApp/Instagram) business onboarding in Phase 1** (approval lead time) even though adapters land in Phase 4.

---

## 14. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Double-booking under concurrency | High | Atomic conditional `UPDATE` (§4.1) + holds; load test; DO fallback |
| Neon HTTP driver: no interactive txns | Med | Design around single-statement atomicity (already the pattern); use pooled WS only where a true txn is unavoidable |
| Duplicate charges | High | Idempotency keys + webhook reconciliation (already hardened) |
| AI quotes wrong price/policy | High | Tools-only actions + RAG grounding + evals + handoff |
| Meta API approval delays | Med | Start onboarding Phase 1 |
| PII/compliance exposure | High | Encryption, consent model, retention, SAQ-A |
| Scope creep (CRM too early) | Med | Phase 5; integrate before building |
| Stale KB answers | Med | Versioned KB + re-embed on change + changelog |

---

## 15. Open questions / decisions needed (blocks firm estimates)

1. Restaurant: confirmed venue capacity, exact slot times, and table inventory model (table-level vs. covers-only)?
2. Tours: confirmed per-session capacity and per-product pricing for the 3 products?
3. Deposit policy per service (percentages, balance timing, refundability)?
4. Payment gateway: stay on **Stripe** (already wired)? Any need for PayPal/local DR methods?
5. Designated email for closed-conversation transcripts (WhatsApp/IG)?
6. Do WhatsApp Business + Instagram/Meta Business accounts exist, and who administers them?
7. Embeddings provider preference: **Voyage AI** vs Cloudflare Workers AI (affects `vector(dim)` + cost)?
8. CRM target if/when integrated (HubSpot/Pipedrive/other)?
9. Languages confirmed EN/ES only at launch?
10. KB content owner + approval process for pricing/policy edits?

---

## 16. New environment variables (added to existing set)

```
# AI
ANTHROPIC_API_KEY=         # Claude Messages API
VOYAGE_API_KEY=            # embeddings (or use Workers AI binding instead)
AGENT_MODEL=claude-...     # pinned model id

# Channels (Meta)
META_VERIFY_TOKEN=         # webhook verification
META_APP_SECRET=           # webhook signature check
WHATSAPP_TOKEN=  WHATSAPP_PHONE_ID=
INSTAGRAM_TOKEN= IG_ACCOUNT_ID=
TRANSCRIPT_EMAIL=          # where closed-chat transcripts go

# Email inbound (if Postmark route chosen)
POSTMARK_INBOUND_TOKEN=

# (existing) DATABASE_URL, ADMIN_TOKEN, RESEND_API_KEY, EMAIL_FROM,
#            STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
```

---

### Immediate next step
Answer §15 (especially 1–3, 6) → I produce the Phase-1 detailed spec (final DDL with capacities, endpoint contracts, booking UI wireframes) and we start the reservation core. Nothing here changes the live site until Phase 1 is approved — the current store/experiences/reservations keep running throughout.
