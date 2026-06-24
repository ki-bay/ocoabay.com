// POST /api/checkout — create an order from the current cart (no card capture yet).
// Body: { name, email, phone, address, city, country, notes }
// Snapshots subtotal/discount/shipping/tax/total, decrements stock, clears cart.
import { neon } from "@neondatabase/serverless";
import { loadCart, priceCart } from "../_lib/pricing.js";
import { getSessionCustomer } from "../_lib/auth.js";

function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    const body = await request.json();
    const email = (body.email || "").trim();
    const name = (body.name || "").trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Valid email required" }, 400);
    if (!name) return json({ error: "Name required" }, 400);

    const sql = neon(env.DATABASE_URL);
    const cartId = getCookie(request, "cart_id");
    const cart = await loadCart(sql, cartId);
    const items = cart?.items || [];
    if (!items.length) return json({ error: "Cart is empty" }, 400);

    const country = (body.country || cart?.country || "DO").toUpperCase();
    const priced = await priceCart(sql, items, { couponCode: cart?.coupon_code, country });
    if (!priced.lines.length) return json({ error: "No valid items" }, 400);

    const customer = await getSessionCustomer(sql, request);
    const shipping = { address: body.address || null, city: body.city || null, country, phone: body.phone || null };

    const rows = await sql`insert into orders
      (status, email, name, phone, shipping, items, subtotal_cents, discount_cents, shipping_cents,
       tax_cents, total_cents, currency, coupon_code, notes, customer_id)
      values ('pending_payment', ${email}, ${name}, ${body.phone || null}, ${JSON.stringify(shipping)},
        ${JSON.stringify(priced.lines)}, ${priced.subtotal_cents}, ${priced.discount_cents},
        ${priced.shipping_cents}, ${priced.tax_cents}, ${priced.total_cents}, ${priced.currency},
        ${priced.coupon?.code || null}, ${body.notes || null}, ${customer?.id || null})
      returning id`;
    const orderId = rows[0].id;

    // Decrement stock atomically for tracked products (low_stock as proxy for quantity if present)
    for (const l of priced.lines) {
      await sql`update products set low_stock = greatest(0, coalesce(low_stock,0) - ${l.qty})
                where woo_id = ${l.product_id} and low_stock is not null`;
    }

    if (cartId) await sql`update carts set items = '[]'::jsonb, coupon_code = null, updated_at = now() where id = ${cartId}`;

    // Fire-and-forget order email (no-op until RESEND_API_KEY is set)
    try {
      const { sendOrderEmail } = await import("../_lib/email.js");
      await sendOrderEmail(env, { orderId, email, name, priced });
    } catch (_) {}

    return json({ ok: true, order_id: orderId, total_cents: priced.total_cents, currency: priced.currency });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
