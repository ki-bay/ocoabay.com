// ZKTeco "Push"/ADMS receiver — the biometric terminal POSTs punches here directly over HTTPS.
//   GET  /iclock/cdata?SN=...            -> handshake/config (tells device to push ATTLOG in realtime)
//   POST /iclock/cdata?SN=...&table=ATTLOG  -> attendance records -> dedup (Neon) -> Odoo hr.attendance
// No on-site PC needed: the device speaks to this Cloudflare endpoint.
import { neon } from "@neondatabase/serverless";
import { odooConfigured, odooAuth, pushAttendance, toOdooUTC } from "../_lib/odoo.js";

const text = (s, code = 200) => new Response(s, { status: code, headers: { "Content-Type": "text/plain" } });

function snAllowed(env, sn) {
  if (!env.DEVICE_SERIALS) return true;                 // dev mode (no allow-list configured)
  return env.DEVICE_SERIALS.split(",").map((x) => x.trim()).includes(sn);
}

export async function onRequestGet({ request, env }) {
  const sn = new URL(request.url).searchParams.get("SN") || "";
  if (!snAllowed(env, sn)) return text("");
  // Standard ADMS config: enable realtime ATTLOG upload.
  return text(`GET OPTION FROM: ${sn}\nStamp=9999\nOpStamp=9999\nErrorDelay=30\nDelay=10\n` +
    `TransTimes=00:00;14:00\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nEncrypt=0\n`);
}

export async function onRequestPost({ request, env }) {
  const u = new URL(request.url);
  const sn = u.searchParams.get("SN") || "";
  if (!snAllowed(env, sn)) return text("OK");           // ack but ignore unknown devices
  const table = u.searchParams.get("table") || "";
  const body = await request.text();
  if (!table.toUpperCase().includes("ATTLOG")) return text("OK");  // OPERLOG/other tables: ack, ignore

  // parse punches: "PIN\tYYYY-MM-DD HH:MM:SS\tstatus\t..."
  const punches = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+(\d+))?/);
    if (m) punches.push({ pin: m[1], time: m[2], status: m[3] || null, raw: line });
  }
  if (!punches.length) return text("OK: 0");

  try {
    const sql = neon(env.DATABASE_URL);
    // dedup-insert; only rows we actually inserted are new work
    const fresh = [];
    for (const p of punches) {
      const r = await sql`insert into device_punches (sn, device_user_id, punched_at, status, raw)
        values (${sn}, ${p.pin}, ${(p.time.replace(" ", "T")) + "-04:00"}, ${p.status}, ${p.raw})
        on conflict (sn, device_user_id, punched_at) do nothing returning id`;
      if (r.length) fresh.push({ id: r[0].id, ...p });
    }

    // push new punches to Odoo (if configured); else leave for replay
    if (fresh.length && odooConfigured(env)) {
      let uid;
      try { uid = await odooAuth(env); } catch (e) { uid = null; }
      if (uid) {
        for (const p of fresh) {
          try {
            const res = await pushAttendance(env, uid, p.pin, toOdooUTC(p.time));
            await sql`update device_punches set odoo_pushed = ${res.action !== "no_employee"}, odoo_result = ${JSON.stringify(res)} where id = ${p.id}`;
          } catch (e) {
            await sql`update device_punches set odoo_result = ${"err:" + e.message} where id = ${p.id}`;
          }
        }
      }
    }
    return text(`OK: ${fresh.length}`);
  } catch (e) {
    // never hard-fail the device; it will retry. Punches are deduped so retries are safe.
    return text("OK");
  }
}
