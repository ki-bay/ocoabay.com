// Replays un-pushed device punches into Odoo. Call on a schedule with Authorization: Bearer <ADMIN_TOKEN>.
// Covers punches recorded while Odoo was not yet configured, or whose push previously failed.
import { neon } from "@neondatabase/serverless";
import { odooConfigured, odooAuth, pushAttendance, toOdooUTC } from "../../_lib/odoo.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  if (!odooConfigured(env)) return json({ ok: true, skipped: "Odoo not configured", pending: null });
  try {
    const sql = neon(env.DATABASE_URL);
    const pending = await sql`select id, device_user_id, punched_at from device_punches
      where odoo_pushed = false order by punched_at limit 200`;
    if (!pending.length) return json({ ok: true, replayed: 0 });
    const uid = await odooAuth(env);
    let done = 0, noemp = 0;
    for (const p of pending) {
      const local = new Date(p.punched_at).toISOString().slice(0, 19).replace("T", " "); // already UTC; pushAttendance expects UTC string
      try {
        const res = await pushAttendance(env, uid, p.device_user_id, local);
        const pushed = res.action !== "no_employee";
        await sql`update device_punches set odoo_pushed = ${pushed}, odoo_result = ${JSON.stringify(res)} where id = ${p.id}`;
        if (pushed) done++; else noemp++;
      } catch (e) {
        await sql`update device_punches set odoo_result = ${"err:" + e.message} where id = ${p.id}`;
      }
    }
    return json({ ok: true, replayed: done, no_employee: noemp, pending_before: pending.length });
  } catch (e) { return json({ error: e.message }, 500); }
}
