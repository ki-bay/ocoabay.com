// POST /api/booking/quote { service, party_size, options? } -> itemised price (ITBIS + Propina separate)
import { db, json, getService, priceBooking } from "../../_lib/booking.js";

export async function onRequestPost({ request, env }) {
  try {
    const sql = db(env);
    const body = await request.json();
    const svc = await getService(sql, body.service);
    if (!svc) return json({ error: "Unknown service" }, 404);
    const price = await priceBooking(sql, svc, body.party_size, body.options || []);
    return json({ ok: true, service: svc.slug, payment: (svc.config && svc.config.payment) || "full", ...price });
  } catch (e) { return json({ error: e.message }, 500); }
}
