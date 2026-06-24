// POST /api/stripe-webhook — Stripe event receiver.
// Verifies the Stripe-Signature with STRIPE_WEBHOOK_SECRET (whsec_...), then on
// payment_intent.succeeded marks the order paid (processing) and sends the receipt.
import { neon } from "@neondatabase/serverless";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Webhook secret not configured", { status: 500 });

  const payload = await request.text();
  const sig = request.headers.get("stripe-signature") || "";
  if (!(await verify(payload, sig, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try { event = JSON.parse(payload); } catch { return new Response("Bad payload", { status: 400 }); }

  try {
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const sql = neon(env.DATABASE_URL);
      const meta = pi.metadata || {};

      // ----- Booking (reservation) payment -----
      if (meta.reservation_id) {
        const upd = await sql`update reservations set state = 'confirmed', status = 'confirmed'
          where id = ${meta.reservation_id} and state = 'pending_payment' returning id`;
        await sql`update payments set status = 'paid', paid_at = now() where reservation_id = ${meta.reservation_id} and kind = 'full'`;
        if (upd.length) {
          try { const { sendBookingEmail } = await import("../_lib/email.js"); await sendBookingEmail(env, { sql, reservationId: meta.reservation_id }); } catch (_) {}
          try { await sql`insert into reservation_events (reservation_id, from_state, to_state, actor) values (${meta.reservation_id}, 'pending_payment', 'confirmed', 'stripe')`; } catch (_) {}
        }
        return new Response("ok");
      }

      // ----- Store order payment -----
      const orderId = meta.order_id ? meta.order_id : null;
      // Match by the PaymentIntent id we stored on the order; fall back to the metadata order_id.
      let rows = await sql`update orders set status = 'processing', paid_at = now()
        where payment_intent = ${pi.id} and status = 'pending_payment'
        returning id, email, name, items, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents`;
      if (!rows.length && orderId) {
        rows = await sql`update orders set status = 'processing', paid_at = now(), payment_intent = ${pi.id}
          where id = ${orderId} and status = 'pending_payment'
          returning id, email, name, items, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents`;
      }
      if (rows.length) {
        const o = rows[0];
        try {
          const { sendOrderEmail } = await import("../_lib/email.js");
          await sendOrderEmail(env, {
            orderId: o.id, email: o.email, name: o.name,
            priced: {
              lines: o.items, currency: o.currency,
              subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents,
              shipping_cents: o.shipping_cents, tax_cents: o.tax_cents, total_cents: o.total_cents,
            },
          });
        } catch (_) {}
      }
    }
    return new Response("ok");
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
}

// Stripe signature check (HMAC-SHA256 over `${t}.${payload}`) using Web Crypto.
async function verify(payload, sigHeader, secret) {
  const parts = {};
  sigHeader.split(",").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1); });
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
