// POST /api/booking/confirm
// { hold_id, name, email, phone?, language?, details? }
// Converts a live hold into a reservation, reserves the seat, and either:
//   - club-house (payment:none)  -> state 'confirmed', sends confirmation email
//   - prepaid (payment:full)     -> state 'pending_payment'; if Stripe configured returns a
//                                   client_secret, else falls back to "we'll arrange payment".
import { db, json, priceBooking, logEvent, stripeApi } from "../../_lib/booking.js";

export async function onRequestPost({ request, env }) {
  try {
    const sql = db(env);
    const b = await request.json();
    const name = (b.name || "").trim();
    const email = (b.email || "").trim();
    const lang = b.language === "es" ? "es" : "en";
    if (!name) return json({ error: "Name required" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Valid email required" }, 400);

    const rows = await sql`select h.id hold_id, h.qty, h.expires_at, h.reservation_id,
      a.id slot_id, a.starts_at, a.service_id,
      s.slug, s.name_en, s.base_price_cents, s.config
      from holds h join availability_slots a on a.id = h.slot_id join services s on s.id = a.service_id
      where h.id = ${b.hold_id}`;
    if (!rows.length) return json({ error: "Hold not found" }, 404);
    const H = rows[0];
    if (H.reservation_id) return json({ error: "Hold already used" }, 409);
    if (new Date(H.expires_at).getTime() < Date.now()) return json({ error: "Hold expired, please reselect" }, 410);

    const svc = { id: H.service_id, base_price_cents: H.base_price_cents, config: H.config || {} };
    const price = await priceBooking(sql, svc, H.qty, (b.details && b.details.options) || []);
    const payMode = svc.config.payment || "full";

    // customer upsert (customers.email is the natural key)
    let cust = await sql`select id from customers where email = ${email}`;
    if (!cust.length) cust = await sql`insert into customers (email, name, phone, language) values (${email}, ${name}, ${b.phone || null}, ${lang}) returning id`;
    const customerId = cust[0].id;

    // reserve the seat (we already hold this capacity) and drop the hold
    await sql`update availability_slots set booked = booked + ${H.qty}, held = greatest(0, held - ${H.qty}) where id = ${H.slot_id}`;
    await sql`delete from holds where id = ${H.hold_id}`;

    const state = payMode === "none" ? "confirmed" : "pending_payment";
    const arrival = new Date(H.starts_at).toISOString().slice(0, 10);
    const details = b.details || {};

    const ins = await sql`insert into reservations
      (experience, name, email, phone, arrival_date, people, message, status,
       customer_id, service_id, slot_id, state, party_size, details, language,
       subtotal_cents, tax_cents, service_charge_cents, total_cents, deposit_cents, source, raw)
      values (${H.name_en}, ${name}, ${email}, ${b.phone || null}, ${arrival}, ${H.qty}, ${details.message || null}, ${state},
       ${customerId}, ${H.service_id}, ${H.slot_id}, ${state}, ${H.qty}, ${JSON.stringify(details)}, ${lang},
       ${price.subtotal_cents}, ${price.tax_cents}, ${price.service_charge_cents}, ${price.total_cents}, 0, 'web', ${JSON.stringify(b)})
      returning id`;
    const rid = ins[0].id;
    await logEvent(sql, rid, null, state, "web", { slug: H.slug, qty: H.qty });

    // confirmed (no online payment) — email now
    if (state === "confirmed") {
      try { const { sendBookingEmail } = await import("../../_lib/email.js"); await sendBookingEmail(env, { sql, reservationId: rid }); } catch (_) {}
      return json({ ok: true, reservation_id: rid, state, total_cents: price.total_cents, payment: "none" });
    }

    // prepaid — record a payment row, create a Stripe PaymentIntent if keys present
    await sql`insert into payments (reservation_id, kind, amount_cents, currency, status, idempotency_key)
      values (${rid}, 'full', ${price.total_cents}, ${price.currency}, 'pending', ${rid + ":full"})`;

    if (env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY) {
      const pi = await stripeApi(env, "payment_intents", {
        amount: String(price.total_cents), currency: price.currency.toLowerCase(),
        "automatic_payment_methods[enabled]": "true",
        "metadata[reservation_id]": String(rid), "metadata[kind]": "full",
        ...(email ? { receipt_email: email } : {}),
      });
      if (pi && !pi.error) {
        await sql`update payments set stripe_payment_intent = ${pi.id} where reservation_id = ${rid} and kind = 'full'`;
        return json({ ok: true, reservation_id: rid, state, total_cents: price.total_cents,
          payment: "stripe", client_secret: pi.client_secret, publishable_key: env.STRIPE_PUBLISHABLE_KEY });
      }
    }

    // no Stripe configured — reservation stands; staff arranges payment (email the request)
    try { const { sendBookingEmail } = await import("../../_lib/email.js"); await sendBookingEmail(env, { sql, reservationId: rid, arrange: true }); } catch (_) {}
    return json({ ok: true, reservation_id: rid, state, total_cents: price.total_cents, payment: "arrange" });
  } catch (e) { return json({ error: e.message }, 500); }
}
