-- OcoaBay Phase 1 — reservation core (ADDITIVE; safe to re-run).
-- Extends existing reservations/customers; adds services, slots, holds, payments.

-- ---------- Service catalogue ----------
create table if not exists services (
  id serial primary key,
  slug text unique not null,
  type text not null,                                 -- tour|experience|restaurant|wedding|event|buffet
  name_en text, name_es text,
  active boolean default true,
  pricing_model text not null,                        -- fixed|per_guest|package|quote
  base_price_cents int default 0,
  deposit_bps int default 0,                          -- 2500 = 25% deposit; 0 = none
  capacity_rules jsonb default '{}',
  config jsonb default '{}'
);

create table if not exists service_options (
  id serial primary key,
  service_id int references services(id),
  key text, name_en text, name_es text,
  kind text,                                          -- package|addon|menu|variant
  price_cents int default 0, per_guest boolean default false,
  meta jsonb default '{}'
);

-- ---------- Availability (bookable inventory) ----------
create table if not exists availability_slots (
  id uuid primary key default gen_random_uuid(),
  service_id int references services(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  label text,
  capacity int not null,
  booked int not null default 0,
  held int not null default 0,
  status text not null default 'open',                -- open|closed|blocked
  unique (service_id, starts_at, label)
);
create index if not exists slots_service_time on availability_slots (service_id, starts_at);

-- ---------- Holds (short-lived capacity reservation during checkout) ----------
create table if not exists holds (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references availability_slots(id),
  qty int not null,
  expires_at timestamptz not null,
  reservation_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists holds_expiry on holds (expires_at);

-- ---------- Reservations: extend existing legacy table additively ----------
alter table reservations add column if not exists customer_id uuid;
alter table reservations add column if not exists service_id int;
alter table reservations add column if not exists slot_id uuid;
alter table reservations add column if not exists state text;               -- enquiry|held|pending_payment|confirmed|completed|cancelled|expired|rescheduled
alter table reservations add column if not exists party_size int;
alter table reservations add column if not exists details jsonb default '{}';
alter table reservations add column if not exists language text default 'en';
alter table reservations add column if not exists subtotal_cents int default 0;
alter table reservations add column if not exists tax_cents int default 0;
alter table reservations add column if not exists service_charge_cents int default 0;
alter table reservations add column if not exists total_cents int default 0;
alter table reservations add column if not exists deposit_cents int default 0;
alter table reservations add column if not exists source text default 'web';
alter table reservations add column if not exists hold_id uuid;
create index if not exists resv_state_idx on reservations (state, created_at desc);

create table if not exists reservation_events (
  id bigserial primary key,
  reservation_id uuid references reservations(id),
  at timestamptz not null default now(),
  from_state text, to_state text, actor text, meta jsonb
);

-- ---------- Payments (deposit/full/balance) ----------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reservation_id uuid,
  order_id uuid,
  kind text not null,                                 -- deposit|full|balance
  amount_cents int not null, currency text default 'USD',
  status text not null default 'pending',             -- pending|paid|failed|refunded
  stripe_payment_intent text, idempotency_key text,
  due_at timestamptz, paid_at timestamptz
);
create unique index if not exists payments_idem on payments (idempotency_key) where idempotency_key is not null;

-- ---------- Customers: extend additively ----------
alter table customers add column if not exists phone text;
alter table customers add column if not exists country text;
alter table customers add column if not exists language text default 'en';
alter table customers add column if not exists preferred_channel text;
alter table customers add column if not exists marketing_consent boolean default false;
alter table customers add column if not exists notes text;

alter table holds add column if not exists club_slot_id uuid;
alter table reservations add column if not exists club_slot_id uuid;
