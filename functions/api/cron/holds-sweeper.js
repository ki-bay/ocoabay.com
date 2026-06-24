// Holds sweeper. Call on a schedule with: Authorization: Bearer <ADMIN_TOKEN>.
// (1) releases expired in-flight holds; (2) expires stale Stripe-pending reservations (>60m unpaid),
// freeing their seats. No-Stripe "arrange payment" reservations are left for staff.
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);

    // (1) release capacity for expired holds, then delete them
    await sql`update availability_slots a set held = greatest(0, a.held - h.qty)
      from holds h where h.slot_id = a.id and h.expires_at < now()`;
    const dropped = await sql`delete from holds where expires_at < now() returning id`;

    // (2) expire stale unpaid Stripe reservations (>60 min)
    const stale = await sql`select r.id, r.slot_id, r.party_size from reservations r
      join payments p on p.reservation_id = r.id
      where r.state = 'pending_payment' and p.kind = 'full' and p.status = 'pending'
        and p.stripe_payment_intent is not null and p.created_at < now() - interval '60 minutes'`;
    for (const r of stale) {
      if (r.slot_id && r.party_size) await sql`update availability_slots set booked = greatest(0, booked - ${r.party_size}) where id = ${r.slot_id}`;
      await sql`update reservations set state = 'expired', status = 'expired' where id = ${r.id}`;
      await sql`update payments set status = 'failed' where reservation_id = ${r.id} and status = 'pending'`;
      await sql`insert into reservation_events (reservation_id, from_state, to_state, actor) values (${r.id}, 'pending_payment', 'expired', 'sweeper')`;
    }

    return json({ ok: true, holds_released: dropped.length, reservations_expired: stale.length });
  } catch (e) { return json({ error: e.message }, 500); }
}
