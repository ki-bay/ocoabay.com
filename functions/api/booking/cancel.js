// POST /api/booking/cancel { reservation_id, email } -> cancel (no refund, per policy); frees the seat.
import { db, json, logEvent } from "../../_lib/booking.js";

export async function onRequestPost({ request, env }) {
  try {
    const sql = db(env);
    const b = await request.json();
    const rows = await sql`select id, state, slot_id, club_slot_id, party_size, email from reservations where id = ${b.reservation_id}`;
    if (!rows.length) return json({ error: "Reservation not found" }, 404);
    const r = rows[0];
    if ((b.email || "").trim().toLowerCase() !== (r.email || "").toLowerCase())
      return json({ error: "Email does not match this reservation" }, 403);
    if (["cancelled", "completed", "expired"].includes(r.state)) return json({ error: `Already ${r.state}` }, 409);

    if (r.slot_id && r.party_size) await sql`update availability_slots set booked = greatest(0, booked - ${r.party_size}) where id = ${r.slot_id}`;
    if (r.club_slot_id && r.party_size) await sql`update availability_slots set booked = greatest(0, booked - ${r.party_size}) where id = ${r.club_slot_id}`;
    await sql`update reservations set state = 'cancelled', status = 'cancelled' where id = ${r.id}`;
    await logEvent(sql, r.id, r.state, "cancelled", "customer", { policy: "no-refund" });
    return json({ ok: true, state: "cancelled", refund: false, note: "Per policy, no refund is issued on cancellation." });
  } catch (e) { return json({ error: e.message }, 500); }
}
