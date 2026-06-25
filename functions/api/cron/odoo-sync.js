// Pushes paid store orders + confirmed bookings into Odoo as customer invoices (account.move).
// Schedule with Authorization: Bearer <ADMIN_TOKEN>. Gated: no-op until ODOO_* secrets are set.
import { neon } from "@neondatabase/serverless";
import { odooConfigured, odooAuth, upsertPartner, createInvoice } from "../../_lib/odoo.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const POST = (env) => !!env.ODOO_POST_INVOICES; // optionally auto-validate invoices

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  if (!odooConfigured(env)) return json({ ok: true, skipped: "Odoo not configured" });
  try {
    const sql = neon(env.DATABASE_URL);
    const uid = await odooAuth(env);
    let orders = 0, bookings = 0;

    // --- paid store orders ---
    const ords = await sql`select id, email, name, phone, items, subtotal_cents, tax_cents, shipping_cents, currency
      from orders where status in ('processing','completed') and coalesce(odoo_synced,false) = false limit 50`;
    for (const o of ords) {
      const pid = await upsertPartner(env, uid, { name: o.name, email: o.email, phone: o.phone });
      const lines = (o.items || []).map((l) => ({ name: l.name, qty: l.qty, price_unit: (l.price_cents || 0) / 100 }));
      if (o.shipping_cents) lines.push({ name: "Shipping", qty: 1, price_unit: o.shipping_cents / 100 });
      if (o.tax_cents) lines.push({ name: "ITBIS 18%", qty: 1, price_unit: o.tax_cents / 100 });
      const inv = await createInvoice(env, uid, pid, lines, { ref: "WEB-" + String(o.id).slice(0, 8), post: POST(env) });
      await sql`update orders set odoo_synced = true, odoo_invoice_id = ${inv} where id = ${o.id}`;
      orders++;
    }

    // --- confirmed prepaid bookings (Club House by-consumption has total 0 -> skipped) ---
    const bks = await sql`select r.id, r.email, r.name, r.phone, r.party_size, r.subtotal_cents, r.tax_cents,
      r.service_charge_cents, s.name_en service from reservations r join services s on s.id = r.service_id
      where r.state in ('confirmed','completed') and coalesce(r.total_cents,0) > 0 and coalesce(r.odoo_synced,false) = false limit 50`;
    for (const b of bks) {
      const pid = await upsertPartner(env, uid, { name: b.name, email: b.email, phone: b.phone });
      const lines = [{ name: b.service, qty: b.party_size, price_unit: (b.subtotal_cents / 100) / (b.party_size || 1) }];
      if (b.tax_cents) lines.push({ name: "ITBIS 18%", qty: 1, price_unit: b.tax_cents / 100 });
      if (b.service_charge_cents) lines.push({ name: "Propina Legal 10%", qty: 1, price_unit: b.service_charge_cents / 100 });
      const inv = await createInvoice(env, uid, pid, lines, { ref: "BK-" + String(b.id).slice(0, 8), post: POST(env) });
      await sql`update reservations set odoo_synced = true, odoo_invoice_id = ${inv} where id = ${b.id}`;
      bookings++;
    }

    return json({ ok: true, orders_invoiced: orders, bookings_invoiced: bookings });
  } catch (e) { return json({ error: e.message }, 500); }
}
