// Slot top-up. Call on a schedule with: Authorization: Bearer <ADMIN_TOKEN>.
// Keeps availability_slots filled N days ahead (default 60) for every active session/day service.
// Idempotent (on conflict do nothing). DR timezone is UTC-4 (no DST).
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const TZ = "-04:00";

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const days = parseInt(new URL(request.url).searchParams.get("days") || "60", 10);
    const services = await sql`select id, capacity_rules, config from services where active = true`;

    const base = new Date(Date.now() - 4 * 3600 * 1000); // DR wall clock
    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      dates.push({ ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay() });
    }

    let made = 0;
    for (const s of services) {
      const cfg = s.config || {}, cap = s.capacity_rules || {};
      const opDays = cfg.operating_days || [0, 1, 2, 3, 4, 5, 6];
      const dur = cfg.duration_min || 90;
      for (const { ymd, dow } of dates) {
        if (!opDays.includes(dow)) continue;
        if (Array.isArray(cfg.sessions)) {
          for (const hhmm of cfg.sessions) {
            const startsAt = `${ymd}T${hhmm}:00${TZ}`;
            const endsAt = new Date(new Date(startsAt).getTime() + dur * 60000).toISOString();
            const r = await sql`insert into availability_slots (service_id, starts_at, ends_at, label, capacity)
              values (${s.id}, ${startsAt}, ${endsAt}, ${hhmm}, ${cap.session_cap || 0})
              on conflict (service_id, starts_at, label) do nothing returning id`;
            made += r.length;
          }
        } else if (cap.daily_cap) {
          const r = await sql`insert into availability_slots (service_id, starts_at, ends_at, label, capacity)
            values (${s.id}, ${`${ymd}T11:00:00${TZ}`}, ${`${ymd}T18:30:00${TZ}`}, 'clubhouse-day', ${cap.daily_cap})
            on conflict (service_id, starts_at, label) do nothing returning id`;
          made += r.length;
        }
      }
    }
    return json({ ok: true, slots_created: made, window_days: days });
  } catch (e) { return json({ error: e.message }, 500); }
}
