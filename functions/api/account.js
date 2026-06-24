// My Account API (requires session).
//   GET  /api/account                          -> {customer, orders, addresses}
//   POST /api/account {action:'profile', name}
//   POST /api/account {action:'address', ...address fields}
//   POST /api/account {action:'delete_address', id}
import { neon } from "@neondatabase/serverless";
import { getSessionCustomer } from "../_lib/auth.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const sql = neon(env.DATABASE_URL);
    const c = await getSessionCustomer(sql, request);
    if (!c) return json({ error: "Not authenticated" }, 401);
    const orders = await sql`select id, created_at, status, total_cents, currency, items
      from orders where customer_id = ${c.id} order by created_at desc`;
    const addresses = await sql`select id, type, name, line1, city, region, country, phone, is_default
      from addresses where customer_id = ${c.id} order by is_default desc`;
    return json({ customer: c, orders, addresses });
  } catch (e) { return json({ error: e.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const sql = neon(env.DATABASE_URL);
    const c = await getSessionCustomer(sql, request);
    if (!c) return json({ error: "Not authenticated" }, 401);
    const body = await request.json();

    if (body.action === "profile") {
      await sql`update customers set name = ${body.name || null} where id = ${c.id}`;
      return json({ ok: true });
    }
    if (body.action === "address") {
      if (body.is_default) await sql`update addresses set is_default = false where customer_id = ${c.id}`;
      const rows = await sql`insert into addresses (customer_id, type, name, line1, city, region, country, phone, is_default)
        values (${c.id}, ${body.type || "shipping"}, ${body.name || null}, ${body.line1 || null}, ${body.city || null},
                ${body.region || null}, ${body.country || null}, ${body.phone || null}, ${!!body.is_default})
        returning id`;
      return json({ ok: true, id: rows[0].id });
    }
    if (body.action === "delete_address") {
      await sql`delete from addresses where id = ${body.id} and customer_id = ${c.id}`;
      return json({ ok: true });
    }
    return json({ error: "Bad action" }, 400);
  } catch (e) { return json({ error: e.message }, 500); }
}
