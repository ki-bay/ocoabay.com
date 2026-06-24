// GET /api/payment                  -> { enabled } only (is card payment configured?)
// GET /api/payment?order_id=<uuid>   -> creates/returns a Stripe PaymentIntent for the order
//
// Gated: with no STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY set, returns { enabled:false }
// and the storefront falls back to the "place order, we'll arrange payment" flow.
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Minimal Stripe REST helper (form-encoded) — avoids bundling the Node SDK in Workers.
async function stripe(env, path, params) {
  const opts = { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } };
  if (params) {
    opts.method = "POST";
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(params).toString();
  }
  const r = await fetch(`https://api.stripe.com/v1/${path}`, opts);
  return r.json();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const enabled = !!(env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY);
  const orderId = new URL(request.url).searchParams.get("order_id");
  if (!orderId) return json({ enabled });
  if (!enabled) return json({ enabled: false });

  try {
    const sql = neon(env.DATABASE_URL);
    await sql`alter table orders add column if not exists payment_intent text`;
    const rows = await sql`select id, total_cents, currency, status, email, payment_intent from orders where id = ${orderId}`;
    if (!rows.length) return json({ error: "Order not found" }, 404);
    const o = rows[0];
    if (o.status !== "pending_payment") return json({ error: "Order is not awaiting payment" }, 409);

    // Reuse an existing reusable PaymentIntent, else create a fresh one.
    let pi = null;
    if (o.payment_intent) {
      pi = await stripe(env, `payment_intents/${o.payment_intent}`);
      if (pi && (pi.error || pi.status === "succeeded" || pi.status === "canceled")) pi = null;
    }
    if (!pi) {
      pi = await stripe(env, "payment_intents", {
        amount: String(o.total_cents),
        currency: (o.currency || "usd").toLowerCase(),
        "automatic_payment_methods[enabled]": "true",
        "metadata[order_id]": String(o.id),
        ...(o.email ? { receipt_email: o.email } : {}),
      });
      if (!pi || pi.error) return json({ error: (pi && pi.error && pi.error.message) || "Stripe error" }, 502);
      await sql`update orders set payment_intent = ${pi.id} where id = ${o.id}`;
    }
    return json({ enabled: true, client_secret: pi.client_secret, publishable_key: env.STRIPE_PUBLISHABLE_KEY });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
