// POST /api/booking/hold { slot_id, qty } -> atomic capacity hold (15-min TTL).
// The conditional UPDATE is the no-double-booking primitive.
import { db, json } from "../../_lib/booking.js";

export async function onRequestPost({ request, env }) {
  try {
    const sql = db(env);
    const body = await request.json();
    const qty = Math.max(1, parseInt(body.qty, 10) || 1);
    if (!body.slot_id) return json({ error: "slot_id required" }, 400);

    // Atomic: succeeds only if capacity remains AND the slot is open and beyond the
    // service's lead-time cutoff (enforced here too, not just in availability).
    const upd = await sql`update availability_slots a
      set held = a.held + ${qty}
      from services s
      where a.id = ${body.slot_id} and s.id = a.service_id and a.status = 'open'
        and a.starts_at > now() + make_interval(mins => coalesce((s.capacity_rules->>'lead_time_min')::int, 0))
        and a.booked + a.held + ${qty} <= a.capacity
      returning a.id, a.starts_at, a.label, (s.config->>'uses_clubhouse')::boolean uses_ch`;
    if (!upd.length) return json({ ok: false, error: "Slot unavailable for that party size or too close to start time" }, 409);

    // Tour bookings also consume the Club House day pool (guests continue to casa club).
    let clubSlotId = null;
    if (upd[0].uses_ch) {
      const dateStr = new Date(upd[0].starts_at).toISOString().slice(0, 10);
      const ch = await sql`update availability_slots a
        set held = a.held + ${qty}
        from services s
        where s.id = a.service_id and s.slug = 'club-house' and a.status = 'open'
          and (a.starts_at at time zone 'America/Santo_Domingo')::date = ${dateStr}::date
          and a.booked + a.held + ${qty} <= a.capacity
        returning a.id`;
      if (!ch.length) {
        await sql`update availability_slots set held = greatest(0, held - ${qty}) where id = ${body.slot_id}`;
        return json({ ok: false, error: "Club House is full for that date" }, 409);
      }
      clubSlotId = ch[0].id;
    }

    const h = await sql`insert into holds (slot_id, qty, expires_at, club_slot_id)
      values (${body.slot_id}, ${qty}, now() + interval '15 minutes', ${clubSlotId}) returning id, expires_at`;

    return json({ ok: true, hold_id: h[0].id, expires_at: h[0].expires_at, qty,
      slot: { slot_id: upd[0].id, starts_at: upd[0].starts_at, label: upd[0].label } });
  } catch (e) { return json({ error: e.message }, 500); }
}
