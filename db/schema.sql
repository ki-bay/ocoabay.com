-- Neon Postgres schema for the OcoaBay clone
-- Run in Neon SQL editor, or it is auto-created by the setup script.

-- Form submissions (contact, reservation, etc.)
create table if not exists submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text,
  email       text not null,
  message     text,
  source_page text,
  raw         jsonb
);
create index if not exists submissions_created_at_idx on submissions (created_at desc);

-- Phase 3 (store) tables are added later: products, variants, orders, order_items,
-- customers. Stubbed here for reference.
