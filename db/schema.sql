-- Neon Postgres schema for the OcoaBay clone
-- Run in Neon SQL editor, or via the sync scripts which create tables if needed.

-- ---------- Forms ----------
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

-- ---------- Store: catalog (synced from WooCommerce Store API) ----------
create table if not exists categories (
  id serial primary key,
  woo_id int unique not null,
  name text not null,
  slug text,
  parent_woo_id int,
  description text,
  count int,
  raw jsonb
);

create table if not exists products (
  id serial primary key,
  woo_id int unique not null,
  name text not null,
  slug text,
  type text,
  sku text,
  permalink text,
  price_cents int,
  regular_price_cents int,
  sale_price_cents int,
  on_sale boolean,
  currency text,
  stock_status text,
  description text,
  short_description text,
  images jsonb,
  categories jsonb,
  attributes jsonb,
  variations jsonb,
  raw jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists products_slug_idx on products (slug);

-- ---------- Store: transactional (built in Phase 3 checkout) ----------
-- create table customers (...);   -- migrated from wp_users + new signups
-- create table carts (...);       -- server-side cart keyed by session/user
-- create table orders (...);      -- order header, status, totals, payment ref
-- create table order_items (...); -- line items snapshotting product + price
