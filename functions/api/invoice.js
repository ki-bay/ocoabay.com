// GET /api/invoice?id=<uuid> — printable HTML invoice (browser → "Save as PDF").
import { neon } from "@neondatabase/serverless";

const money = (c, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format((c || 0) / 100);

export async function onRequestGet(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("id required", { status: 400 });
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`select id, created_at, status, email, name, items, subtotal_cents,
      discount_cents, shipping_cents, tax_cents, total_cents, currency, coupon_code from orders where id = ${id} limit 1`;
    if (!rows.length) return new Response("Not found", { status: 404 });
    const o = rows[0];
    const lines = (o.items || []).map((l) => `<tr><td>${l.name} × ${l.qty}</td><td style="text-align:right">${money(l.line_total_cents, o.currency)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${String(o.id).slice(0,8)}</title>
      <style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;color:#2b1a12;padding:0 20px}
      h1{color:#6b3f2a}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:8px 0;border-bottom:1px solid #eee}
      .tot td{border:0}.r{text-align:right}@media print{.noprint{display:none}}</style></head><body>
      <h1>OcoaBay</h1><p>Invoice <strong>${String(o.id).slice(0,8)}</strong> · ${new Date(o.created_at).toLocaleDateString()}</p>
      <p>${o.name || ""} &lt;${o.email}&gt; · Status: ${o.status.replace("_"," ")}</p>
      <table>${lines}
      <tr class="tot"><td>Subtotal</td><td class="r">${money(o.subtotal_cents,o.currency)}</td></tr>
      ${o.discount_cents ? `<tr class="tot"><td>Discount ${o.coupon_code?`(${o.coupon_code})`:""}</td><td class="r">−${money(o.discount_cents,o.currency)}</td></tr>` : ""}
      <tr class="tot"><td>Shipping</td><td class="r">${money(o.shipping_cents,o.currency)}</td></tr>
      <tr class="tot"><td>Tax (ITBIS)</td><td class="r">${money(o.tax_cents,o.currency)}</td></tr>
      <tr class="tot"><td><strong>Total</strong></td><td class="r"><strong>${money(o.total_cents,o.currency)}</strong></td></tr></table>
      <button class="noprint" onclick="print()">Print / Save as PDF</button>
      <p style="font-size:12px;color:#999;margin-top:30px">OcoaBay · Azua, Dominican Republic · ocoabay.com</p></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) { return new Response("Error: " + e.message, { status: 500 }); }
}
