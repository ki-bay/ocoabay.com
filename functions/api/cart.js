// Cart API — server-authoritative pricing, cookie session.
//   GET  /api/cart                                  -> current cart with line items + totals
//   POST /api/cart  {action:'add', product_id, qty} -> add (qty default 1)
//   POST /api/cart  {action:'update', product_id, qty}
//   POST /api/cart  {action:'remove', product_id}
//   POST /api/cart  {action:'clear'}
import { neon } from "@neondatabase/serverless";

const COOKIE = "cart_id";

function getCookie(request, name) {
  const h = request.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

async function loadCart(sql, id) {
  if (!id) return null;
  const rows = await sql`select id, items from carts where id = ${id} limit 1`;
  return rows[0] || null;
}

// Build line items with server-side prices from the products table.
async function priceCart(sql, items) {
  if (!items.length) return { lines: [], subtotal_cents: 0, currency: "USD", count: 0 };
  const ids = items.map((i) => i.product_id);
  const prods = await sql`select woo_id, name, slug, price_cents, currency, images, stock_status
                          from products where woo_id = any(${ids})`;
  const byId = Object.fromEntries(prods.map((p) => [p.woo_id, p]));
  let subtotal = 0, count = 0, currency = "USD";
  const lines = [];
  for (const it of items) {
    const p = byId[it.product_id];
    if (!p) continue;
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const line = (p.price_cents || 0) * qty;
    subtotal += line; count += qty; currency = p.currency || currency;
    lines.push({
      product_id: p.woo_id, name: p.name, slug: p.slug, qty,
      price_cents: p.price_cents, line_total_cents: line,
      image: Array.isArray(p.images) && p.images[0] ? (p.images[0].thumbnail || p.images[0].src) : null,
      stock_status: p.stock_status,
    });
  }
  return { lines, subtotal_cents: subtotal, currency, count };
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
    const priced = await priceCart(sql, cart ? cart.items : []);
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
      const created = await sql`insert into carts (items) values ('[]'::jsonb) returning id, items`;
      cart = created[0]; id = cart.id;
    }
    let items = Array.isArray(cart.items) ? cart.items : [];

    const pid = body.product_id != null ? parseInt(body.product_id, 10) : null;
    const qty = body.qty != null ? parseInt(body.qty, 10) : 1;

    if (action === "add" && pid) {
      const ex = items.find((i) => i.product_id === pid);
      if (ex) ex.qty += qty > 0 ? qty : 1;
      else items.push({ product_id: pid, qty: qty > 0 ? qty : 1 });
    } else if (action === "update" && pid) {
      const ex = items.find((i) => i.product_id === pid);
      if (ex) ex.qty = Math.max(1, qty);
      if (qty <= 0) items = items.filter((i) => i.product_id !== pid);
    } else if (action === "remove" && pid) {
      items = items.filter((i) => i.product_id !== pid);
    } else if (action === "clear") {
      items = [];
    } else {
      return json({ error: "Bad action" }, { status: 400 });
    }

    await sql`update carts set items = ${JSON.stringify(items)}, updated_at = now() where id = ${id}`;
    const priced = await priceCart(sql, items);
    const cookie = `${COOKIE}=${id}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
    return json({ cart_id: id, ...priced }, { cookie });
  } catch (e) { return json({ error: e.message }, { status: 500 }); }
}
