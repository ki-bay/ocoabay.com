// Booking core helpers: per-service pricing with ITBIS (tax) + Propina Legal (service charge)
// as separate lines. Shared by the /api/booking/* endpoints.
import { neon } from "@neondatabase/serverless";

export const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function db(env) { return neon(env.DATABASE_URL); }

export async function getService(sql, slug) {
  const r = await sql`select id, slug, type, name_en, name_es, pricing_model, base_price_cents,
    deposit_bps, capacity_rules, config from services where slug = ${slug} and active = true`;
  return r[0] || null;
}

// Server-authoritative price. options: [{key, qty?}] resolved against service_options.
export async function priceBooking(sql, service, partySize, options = []) {
  const cfg = service.config || {};
  const qty = Math.max(1, parseInt(partySize, 10) || 1);
  let subtotal = (service.base_price_cents || 0) * qty;

  if (options.length) {
    const keys = options.map((o) => o.key);
    const rows = await sql`select key, price_cents, per_guest from service_options
      where service_id = ${service.id} and key = any(${keys})`;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const o of options) {
      const so = byKey[o.key]; if (!so) continue;
      subtotal += (so.price_cents || 0) * (so.per_guest ? qty : (parseInt(o.qty, 10) || 1));
    }
  }

  const taxBps = cfg.tax_bps || 0;            // ITBIS 18%
  const svcBps = cfg.service_charge_bps || 0; // Propina Legal 10% (dine-in)
  const tax_cents = Math.round(subtotal * taxBps / 10000);
  const service_charge_cents = Math.round(subtotal * svcBps / 10000);
  const total_cents = subtotal + tax_cents + service_charge_cents;
  return {
    currency: "USD", party_size: qty,
    subtotal_cents: subtotal, tax_cents, service_charge_cents, total_cents,
    lines: [
      { label: "Subtotal", cents: subtotal },
      ...(tax_cents ? [{ label: "ITBIS (18%)", cents: tax_cents }] : []),
      ...(service_charge_cents ? [{ label: "Propina Legal (10%)", cents: service_charge_cents }] : []),
      { label: "Total", cents: total_cents, total: true },
    ],
  };
}

// Tour guests continue to the Club House, so a tour booking also consumes the Club House
// day pool (100/day). Returns the club-house day slot for a given DR date (YYYY-MM-DD), or null.
export async function clubhouseSlotForDate(sql, dateStr) {
  const r = await sql`select a.id, a.capacity, a.booked, a.held from availability_slots a
    join services s on s.id = a.service_id
    where s.slug = 'club-house' and (a.starts_at at time zone 'America/Santo_Domingo')::date = ${dateStr}::date
    limit 1`;
  return r[0] || null;
}

export function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function logEvent(sql, reservationId, from, to, actor, meta = {}) {
  await sql`insert into reservation_events (reservation_id, from_state, to_state, actor, meta)
    values (${reservationId}, ${from}, ${to}, ${actor}, ${JSON.stringify(meta)})`;
}

// Minimal Stripe REST helper (form-encoded) — shared with the store payment flow.
export async function stripeApi(env, path, params) {
  const opts = { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  if (params) {
    opts.method = "POST";
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(params).toString();
  }
  const r = await fetch(`https://api.stripe.com/v1/${path}`, opts);
  return r.json();
}
