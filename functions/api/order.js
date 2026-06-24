// GET /api/order?id=<uuid> — fetch a single order for the confirmation page.
import { neon } from "@neondatabase/serverless";

export async function onRequestGet(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get("id");
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!id) return json({ error: "id required" }, 400);
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`select id, created_at, status, email, name, items,
      subtotal_cents, total_cents, currency from orders where id = ${id} limit 1`;
    if (!rows.length) return json({ error: "Not found" }, 404);
    return json(rows[0]);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
