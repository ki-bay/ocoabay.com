// POST /api/booking/hold { slot_id, qty } -> atomic capacity hold (15-min TTL).
// The conditional UPDATE is the no-double-booking primitive.
import { db, json } from "../../_lib/booking.js";

export async function onRequestPost({ request, env }) {
  try {
    const sql = db(env);
    const body = await request.json();
    const qty = Math.max(1, parseInt(body.qty, 10) || 1);
    if (!body.slot_id) return json({ error: "slot_id required" }, 400);

    // Atomic: only succeeds if capacity remains and the slot is future + open.
    const upd = await sql`update availability_slots
      set held = held + ${qty}
      where id = ${body.slot_id} and status = 'open' and starts_at > now()
        and booked + held + ${qty} <= capacity
      returning id, starts_at, label, capacity, booked, held`;
    if (!upd.length) return json({ ok: false, error: "Slot unavailable for that party size" }, 409);

    const h = await sql`insert into holds (slot_id, qty, expires_at)
      values (${body.slot_id}, ${qty}, now() + interval '15 minutes') returning id, expires_at`;

    return json({ ok: true, hold_id: h[0].id, expires_at: h[0].expires_at, qty,
      slot: { slot_id: upd[0].id, starts_at: upd[0].starts_at, label: upd[0].label } });
  } catch (e) { return json({ error: e.message }, 500); }
}
