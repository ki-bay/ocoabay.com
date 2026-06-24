// Cart API — server-authoritative pricing (subtotal+coupon+shipping+tax), cookie session.
//   GET  /api/cart
//   POST /api/cart {action:'add'|'update'|'remove', product_id, qty}
//   POST /api/cart {action:'clear'}
//   POST /api/cart {action:'coupon', code}        apply/replace coupon ('' to remove)
//   POST /api/cart {action:'country', country}     set shipping country for estimate
import { neon } from "@neondatabase/serverless";
import { loadCart, priceCart } from "../_lib/pricing.js";

const COOKIE = "cart_id";
function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function json(data, { status = 200, cookie } = {}) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const sql = neon(env.DATABASE_URL);
    const id = getCookie(request, COOKIE);
    const cart = await loadCart(sql, id);
    const priced = await priceCart(sql, cart ? cart.items : [], { couponCode: cart?.coupon_code, country: cart?.country });
    return json({ cart_id: id, ...priced });
  } catch (e) { return json({ error: e.message }, { status: 500 }); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const sql = neon(env.DATABASE_URL);
    const body = await request.json();
    const action = body.action;
    let id = getCookie(request, COOKIE);
    let cart = await loadCart(sql, id);
    if (!cart) {
      const created = await sql`insert into carts (items) values ('[]'::jsonb) returning id, items, coupon_code, country`;
      cart = created[0]; id = cart.id;
    }
    let items = Array.isArray(cart.items) ? cart.items : [];
    let coupon = cart.coupon_code || null;
    let country = cart.country || "DO";

    const pid = body.product_id != null ? parseInt(body.product_id, 10) : null;
    const qty = body.qty != null ? parseInt(body.qty, 10) : 1;

    if (action === "add" && pid) {
      const ex = items.find((i) => i.product_id === pid);
      if (ex) ex.qty += qty > 0 ? qty : 1; else items.push({ product_id: pid, qty: qty > 0 ? qty : 1 });
    } else if (action === "update" && pid) {
      const ex = items.find((i) => i.product_id === pid);
      if (ex) ex.qty = Math.max(1, qty);
      if (qty <= 0) items = items.filter((i) => i.product_id !== pid);
    } else if (action === "remove" && pid) {
      items = items.filter((i) => i.product_id !== pid);
    } else if (action === "clear") {
      items = []; coupon = null;
    } else if (action === "coupon") {
      coupon = (body.code || "").trim() || null;
    } else if (action === "country") {
      country = (body.country || "DO").trim() || "DO";
    } else {
      return json({ error: "Bad action" }, { status: 400 });
    }

    await sql`update carts set items = ${JSON.stringify(items)}, coupon_code = ${coupon},
              country = ${country}, updated_at = now() where id = ${id}`;
    const priced = await priceCart(sql, items, { couponCode: coupon, country });
    // if coupon invalid, drop it from the cart so it doesn't stick
    if (priced.coupon_error) await sql`update carts set coupon_code = null where id = ${id}`;
    const cookie = `${COOKIE}=${id}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
    return json({ cart_id: id, ...priced }, { cookie });
  } catch (e) { return json({ error: e.message }, { status: 500 }); }
}
