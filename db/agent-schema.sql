-- OcoaBay — AI customer-service agent schema (additive, safe to re-run).

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_id uuid,
  channel text not null default 'web',          -- web|whatsapp|instagram|email
  external_id text,                              -- WA phone / IG thread / email id
  language text default 'en',
  status text not null default 'open',           -- open|handoff|closed
  assigned_to text,
  updated_at timestamptz not null default now()
);
create unique index if not exists conv_channel_ext on conversations (channel, external_id) where external_id is not null;

create table if not exists messages (
  id bigserial primary key,
  conversation_id uuid references conversations(id),
  at timestamptz not null default now(),
  role text not null,                            -- user|assistant|tool
  content text,
  tool_name text,
  tool_payload jsonb
);
create index if not exists messages_conv on messages (conversation_id, at);

create table if not exists agent_runs (
  id bigserial primary key,
  conversation_id uuid,
  at timestamptz not null default now(),
  model text, input_tokens int, output_tokens int, latency_ms int,
  tools_called jsonb, escalated boolean default false
);

create table if not exists kb_documents (
  id serial primary key,
  slug text not null,
  lang text not null default 'en',
  title text,
  body text not null,
  tags text,
  updated_at timestamptz not null default now(),
  unique (slug, lang)
);
