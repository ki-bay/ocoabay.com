-- Supabase schema for the OcoaBay clone
-- Run in Supabase → SQL Editor, or via `supabase db push`.

-- Form submissions (contact, reservation, etc.)
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text,
  email       text not null,
  message     text,
  source_page text,
  raw         jsonb
);

-- Helpful index for the admin view
create index if not exists submissions_created_at_idx
  on public.submissions (created_at desc);

-- Row Level Security: lock the table down.
-- Inserts happen server-side via the service role key (which bypasses RLS),
-- so we deny all anon/auth access by default.
alter table public.submissions enable row level security;

-- (Optional) allow authenticated admins to read. Define an "admins" notion
-- later; for now, no public policies = no public access.

-- ---------------------------------------------------------------------------
-- Future: store / products tables to replace WooCommerce. Stubbed for later.
-- ---------------------------------------------------------------------------
-- create table if not exists public.products (
--   id uuid primary key default gen_random_uuid(),
--   slug text unique not null,
--   title text not null,
--   description text,
--   price_cents integer not null,
--   currency text not null default 'USD',
--   images jsonb,
--   active boolean not null default true,
--   created_at timestamptz not null default now()
-- );
