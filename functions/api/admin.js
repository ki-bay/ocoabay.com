// Admin order management — requires Authorization: Bearer <ADMIN_TOKEN>.
//   GET  /api/admin?view=orders
//   POST /api/admin {action:'status', id, status}
//   POST /api/admin {action:'tracking', id, tracking}
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const STATUSES = ["pending_payment", "processing", "completed", "shipped", "cancelled", "refunded"];

function authed(request, env) {
  const h = request.headers.get("Authorization") || "";
  return env.ADMIN_TOKEN && h === `Bearer ${env.ADMIN_TOKEN}`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const orders = await sql`select id, created_at, status, email, name, total_cents, currency,
      coupon_code, tracking, items from orders order by created_at desc limit 200`;
    const stats = await sql`select status, count(*)::int n, coalesce(sum(total_cents),0)::int rev from orders group by status`;
    return json({ orders, stats, statuses: STATUSES });
  } catch (e) { return json({ error: e.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const body = await request.json();
    if (body.action === "status") {
      if (!STATUSES.includes(body.status)) return json({ error: "Bad status" }, 400);
      const paid = body.status === "completed" || body.status === "processing";
      await sql`update orders set status = ${body.status}, paid_at = case when ${paid} and paid_at is null then now() else paid_at end where id = ${body.id}`;
      return json({ ok: true });
    }
    if (body.action === "tracking") {
      await sql`update orders set tracking = ${body.tracking || null} where id = ${body.id}`;
      return json({ ok: true });
    }
    return json({ error: "Bad action" }, 400);
  } catch (e) { return json({ error: e.message }, 500); }
}
