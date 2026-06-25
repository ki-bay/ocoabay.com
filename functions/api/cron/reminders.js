// Lifecycle automation. Call on a schedule with: Authorization: Bearer <ADMIN_TOKEN>.
//  (1) Reminder email for confirmed bookings happening in the next ~24-48h (once).
//  (2) Auto-complete bookings whose time has passed, and send a thank-you / review email.
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    await sql`alter table reservations add column if not exists reminded_at timestamptz`;
    const email = await import("../../_lib/email.js");

    // (1) reminders: confirmed, starts within 48h, not yet reminded
    const due = await sql`select r.id from reservations r join availability_slots a on a.id = r.slot_id
      where r.state = 'confirmed' and r.reminded_at is null
        and a.starts_at > now() and a.starts_at < now() + interval '48 hours' limit 100`;
    let reminded = 0;
    for (const r of due) {
      try { await email.sendBookingReminder(env, { sql, reservationId: r.id }); } catch (_) {}
      await sql`update reservations set reminded_at = now() where id = ${r.id}`;
      reminded++;
    }

    // (2) completion + thank-you: confirmed bookings whose slot end is in the past
    const past = await sql`select r.id from reservations r join availability_slots a on a.id = r.slot_id
      where r.state = 'confirmed' and coalesce(a.ends_at, a.starts_at) < now() limit 100`;
    let completed = 0;
    for (const r of past) {
      await sql`update reservations set state = 'completed', status = 'completed' where id = ${r.id}`;
      await sql`insert into reservation_events (reservation_id, from_state, to_state, actor) values (${r.id}, 'confirmed', 'completed', 'cron')`;
      try { await email.sendThankYou(env, { sql, reservationId: r.id }); } catch (_) {}
      completed++;
    }

    return json({ ok: true, reminders_sent: reminded, completed });
  } catch (e) { return json({ error: e.message }, 500); }
}
