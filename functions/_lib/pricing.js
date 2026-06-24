// Shared commerce pricing — used by /api/cart, /api/checkout, /api/quote.
// All money in integer cents. Server-authoritative (never trusts client prices).

export async function loadCart(sql, id) {
  if (!id) return null;
  const rows = await sql`select id, items, coupon_code, country from carts where id = ${id} limit 1`;
  return rows[0] || null;
}

export async function validateCoupon(sql, code, subtotalCents) {
  if (!code) return null;
  const rows = await sql`select code, type, amount, min_subtotal_cents, free_shipping, product_ids, expires_at, active
                         from coupons where lower(code) = lower(${code}) and active = true limit 1`;
  const c = rows[0];
  if (!c) return { error: "Invalid coupon code" };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { error: "Coupon expired" };
  if (subtotalCents < (c.min_subtotal_cents || 0))
    return { error: `Spend at least $${((c.min_subtotal_cents || 0) / 100).toFixed(2)} to use this code` };
  return { coupon: c };
}

// items: [{product_id, qty}], opts: {couponCode, country}
export async function priceCart(sql, items, opts = {}) {
  const out = {
    lines: [], subtotal_cents: 0, discount_cents: 0, shipping_cents: 0, tax_cents: 0,
    total_cents: 0, currency: "USD", count: 0, coupon: null, coupon_error: null,
    free_shipping: false,
  };
  if (!items || !items.length) return out;

  const ids = items.map((i) => i.product_id);
  const prods = await sql`select woo_id, name, slug, price_cents, currency, images, stock_status, low_stock
                          from products where woo_id = any(${ids})`;
  const byId = Object.fromEntries(prods.map((p) => [p.woo_id, p]));

  for (const it of items) {
    const p = byId[it.product_id];
    if (!p) continue;
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const lt = (p.price_cents || 0) * qty;
    out.subtotal_cents += lt; out.count += qty; out.currency = p.currency || out.currency;
    out.lines.push({
      product_id: p.woo_id, name: p.name, slug: p.slug, qty,
      price_cents: p.price_cents, line_total_cents: lt,
      image: Array.isArray(p.images) && p.images[0] ? (p.images[0].thumbnail || p.images[0].src) : null,
      stock_status: p.stock_status, low_stock: p.low_stock,
    });
  }

  // Coupon
  if (opts.couponCode) {
    const v = await validateCoupon(sql, opts.couponCode, out.subtotal_cents);
    if (v?.error) out.coupon_error = v.error;
    else if (v?.coupon) {
      const c = v.coupon;
      let disc = 0;
      if (c.type === "percent") disc = Math.round(out.subtotal_cents * (Number(c.amount) / 100));
      else if (c.type === "fixed") disc = Math.min(out.subtotal_cents, Math.round(Number(c.amount) * 100));
      out.discount_cents = disc;
      out.coupon = { code: c.code, type: c.type, amount: Number(c.amount), free_shipping: c.free_shipping };
      if (c.free_shipping) out.free_shipping = true;
    }
  }

  const taxable = out.subtotal_cents - out.discount_cents;

  // Shipping (flat with free-over threshold)
  const country = (opts.country || "DO").toUpperCase();
  const ship = await sql`select flat_cents, free_over_cents from shipping_rates
    where active = true and (country = ${country} or country is null) order by sort limit 1`;
  if (ship[0] && !out.free_shipping) {
    const r = ship[0];
    out.shipping_cents = (r.free_over_cents != null && taxable >= r.free_over_cents) ? 0 : (r.flat_cents || 0);
  }

  // Tax (on discounted subtotal)
  const tax = await sql`select rate_bps from tax_rates where (country = ${country} or country is null) limit 1`;
  if (tax[0]) out.tax_cents = Math.round(taxable * (tax[0].rate_bps / 10000));

  out.total_cents = taxable + out.shipping_cents + out.tax_cents;
  return out;
}
