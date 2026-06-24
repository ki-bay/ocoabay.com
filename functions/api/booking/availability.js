// GET /api/booking/availability?service=<slug>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns upcoming open slots with remaining capacity (respects lead time).
import { db, json, getService } from "../../_lib/booking.js";

export async function onRequestGet({ request, env }) {
  try {
    const sql = db(env);
    const u = new URL(request.url);
    const svc = await getService(sql, u.searchParams.get("service"));
    if (!svc) return json({ error: "Unknown service" }, 404);
    const leadMin = (svc.capacity_rules && svc.capacity_rules.lead_time_min) || 0;

    const rows = await sql`select id, starts_at, ends_at, label, capacity, booked, held
      from availability_slots
      where service_id = ${svc.id} and status = 'open'
        and starts_at > now() + make_interval(mins => ${leadMin})
      order by starts_at limit 400`;

    const from = u.searchParams.get("from"), to = u.searchParams.get("to");
    const slots = rows
      .map((r) => ({
        slot_id: r.id, starts_at: new Date(r.starts_at).toISOString(), ends_at: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        label: r.label, capacity: r.capacity, remaining: Math.max(0, r.capacity - r.booked - r.held),
      }))
      .filter((r) => (!from || r.starts_at.slice(0, 10) >= from) && (!to || r.starts_at.slice(0, 10) <= to));

    return json({
      service: { slug: svc.slug, type: svc.type, name_en: svc.name_en, name_es: svc.name_es,
        base_price_cents: svc.base_price_cents, pricing_model: svc.pricing_model },
      slots,
    });
  } catch (e) { return json({ error: e.message }, 500); }
}
