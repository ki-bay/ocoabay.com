// Generate availability_slots N days ahead for all session/day services.
// Idempotent (on conflict do nothing). DR timezone is UTC-4 (no DST). Run: node db/generate-slots.mjs [days]
import { neon } from "@neondatabase/serverless";
import fs from "fs";

const m = fs.readFileSync(".dev.vars", "utf8").match(/^DATABASE_URL=(.+)$/m);
const sql = neon(m[1].trim().replace(/^["']|["']$/g, ""));
const DAYS = parseInt(process.argv[2] || "60", 10);
const TZ = "-04:00"; // Dominican Republic

const services = await sql`select id, slug, capacity_rules, config from services where active = true`;

// build a list of calendar dates (DR local) starting today
const base = new Date(Date.now() - 4 * 3600 * 1000); // shift to DR local wall clock
const dates = [];
for (let i = 0; i < DAYS; i++) {
  const d = new Date(base.getTime() + i * 86400000);
  dates.push({ ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay() }); // 0=Sun..6=Sat
}

let made = 0;
for (const s of services) {
  const cfg = s.config || {}, cap = s.capacity_rules || {};
  const days = cfg.operating_days || [0, 1, 2, 3, 4, 5, 6];
  const dur = cfg.duration_min || 90;
  for (const { ymd, dow } of dates) {
    if (!days.includes(dow)) continue;
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
      const startsAt = `${ymd}T11:00:00${TZ}`;
      const endsAt = `${ymd}T18:30:00${TZ}`;
      const r = await sql`insert into availability_slots (service_id, starts_at, ends_at, label, capacity)
        values (${s.id}, ${startsAt}, ${endsAt}, 'clubhouse-day', ${cap.daily_cap})
        on conflict (service_id, starts_at, label) do nothing returning id`;
      made += r.length;
    }
  }
}
const counts = await sql`select s.slug, count(*)::int n from availability_slots a join services s on s.id=a.service_id group by s.slug order by s.slug`;
console.log(`generated ${made} new slots`);
for (const c of counts) console.log(`  ${c.slug.padEnd(16)} ${c.n} slots`);
