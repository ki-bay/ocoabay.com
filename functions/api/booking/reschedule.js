// POST /api/booking/reschedule { reservation_id, email, new_slot_id }
// Allowed only > reschedule_cutoff_h (72h) before the current slot. Atomic move; no refund involved.
import { db, json, logEvent } from "../../_lib/booking.js";

export async function onRequestPost({ request, env }) {
  try {
    const sql = db(env);
    const b = await request.json();
    const rows = await sql`select r.id, r.state, r.slot_id, r.party_size, r.email, r.service_id,
      a.starts_at cur_start, (s.capacity_rules->>'reschedule_cutoff_h')::int cutoff_h
      from reservations r join availability_slots a on a.id = r.slot_id join services s on s.id = r.service_id
      where r.id = ${b.reservation_id}`;
    if (!rows.length) return json({ error: "Reservation not found" }, 404);
    const r = rows[0];
    if ((b.email || "").trim().toLowerCase() !== (r.email || "").toLowerCase())
      return json({ error: "Email does not match this reservation" }, 403);
    if (!["confirmed", "pending_payment"].includes(r.state)) return json({ error: `Cannot reschedule a ${r.state} reservation` }, 409);

    const hoursToStart = (new Date(r.cur_start).getTime() - Date.now()) / 3600000;
    if (hoursToStart <= (r.cutoff_h || 72))
      return json({ ok: false, error: `Reschedule is only allowed more than ${r.cutoff_h || 72}h before your reservation.` }, 409);

    const qty = r.party_size || 1;
    const moved = await sql`update availability_slots set booked = booked + ${qty}
      where id = ${b.new_slot_id} and service_id = ${r.service_id} and status = 'open'
        and starts_at > now() and booked + held + ${qty} <= capacity
      returning starts_at`;
    if (!moved.length) return json({ ok: false, error: "New slot unavailable for your party size" }, 409);

    await sql`update availability_slots set booked = greatest(0, booked - ${qty}) where id = ${r.slot_id}`;
    const newStart = moved[0].starts_at;
    await sql`update reservations set slot_id = ${b.new_slot_id}, arrival_date = ${new Date(newStart).toISOString().slice(0, 10)} where id = ${r.id}`;
    await logEvent(sql, r.id, r.state, r.state, "customer", { action: "rescheduled", from_slot: r.slot_id, to_slot: b.new_slot_id, new_start: newStart });

    return json({ ok: true, new_starts_at: newStart });
  } catch (e) { return json({ error: e.message }, 500); }
}
