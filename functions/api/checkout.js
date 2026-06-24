// POST /api/checkout — create an order from the current cart (no payment yet).
// Body: { name, email, phone, address, city, country }
// Creates an order (status 'pending_payment'), clears the cart, returns order id.
import { neon } from "@neondatabase/serverless";

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
    const cartRows = cartId ? await sql`select items from carts where id = ${cartId}` : [];
    const items = cartRows[0]?.items || [];
    if (!items.length) return json({ error: "Cart is empty" }, 400);

    // Re-price server-side (never trust client)
    const ids = items.map((i) => i.product_id);
    const prods = await sql`select woo_id, name, slug, price_cents, currency from products where woo_id = any(${ids})`;
    const byId = Object.fromEntries(prods.map((p) => [p.woo_id, p]));
    let subtotal = 0, currency = "USD";
    const lineItems = [];
    for (const it of items) {
      const p = byId[it.product_id];
      if (!p) continue;
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const lt = (p.price_cents || 0) * qty;
      subtotal += lt; currency = p.currency || currency;
      lineItems.push({ product_id: p.woo_id, name: p.name, slug: p.slug, qty, price_cents: p.price_cents, line_total_cents: lt });
    }
    if (!lineItems.length) return json({ error: "No valid items" }, 400);

    const shipping = {
      address: body.address || null, city: body.city || null,
      country: body.country || null, phone: body.phone || null,
    };
    const total = subtotal; // shipping/tax added later

    const rows = await sql`insert into orders
      (status, email, name, phone, shipping, items, subtotal_cents, total_cents, currency)
      values ('pending_payment', ${email}, ${name}, ${body.phone || null}, ${JSON.stringify(shipping)},
              ${JSON.stringify(lineItems)}, ${subtotal}, ${total}, ${currency})
      returning id`;
    const orderId = rows[0].id;

    // Clear the cart
    if (cartId) await sql`update carts set items = '[]'::jsonb, updated_at = now() where id = ${cartId}`;

    return json({ ok: true, order_id: orderId, total_cents: total, currency });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
