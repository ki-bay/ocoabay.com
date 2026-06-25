// Day-of report. Call with Authorization: Bearer <ADMIN_TOKEN>.
// Emails CS@ocoabay.com the list of bookings happening TODAY whose 100% payment isn't complete
// (deposit paid but balance outstanding, or unpaid). Run early each operating morning.
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const money = (c) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((c || 0) / 100);

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`select r.name, r.email, r.phone, r.party_size, r.balance_cents, r.pay_currency, r.pay_mode,
      s.name_en service, a.starts_at
      from reservations r join services s on s.id = r.service_id join availability_slots a on a.id = r.slot_id
      where r.balance_cents > 0 and r.state in ('confirmed','pending_payment')
        and r.arrival_date = (now() at time zone 'America/Santo_Domingo')::date
      order by a.starts_at`;
    const to = env.CS_EMAIL || "CS@ocoabay.com";
    if (!rows.length) return json({ ok: true, count: 0 });

    const fmt = (d) => new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(d));
    const list = rows.map((r) =>
      `<tr><td>${fmt(r.starts_at)}</td><td>${r.service}</td><td>${r.name || ""}</td><td>${r.email}${r.phone ? " · " + r.phone : ""}</td>
       <td align="center">${r.party_size}</td><td align="right">${money(r.balance_cents)}${r.pay_currency === "DOP" ? " (DOP)" : ""}</td></tr>`).join("");
    const total = rows.reduce((a, r) => a + (r.balance_cents || 0), 0);

    const { sendEmail } = await import("../../_lib/email.js");
    await sendEmail(env, { to, subject: `OcoaBay — today's bookings with balance due (${rows.length})`,
      html: `<div style="font-family:Georgia,serif;max-width:660px;color:#2b1a12">
        <h3 style="color:#74181B">Balance due today / Saldo pendiente hoy</h3>
        <p>${rows.length} booking(s) arriving today have not completed the 100% payment. Please collect on arrival.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px" border="1" cellpadding="6">
          <tr style="background:#f6ecec"><th>Time</th><th>Experience</th><th>Guest</th><th>Contact</th><th>Pax</th><th>Balance</th></tr>
          ${list}
          <tr><td colspan="5" align="right"><strong>Total outstanding</strong></td><td align="right"><strong>${money(total)}</strong></td></tr>
        </table></div>` });

    return json({ ok: true, count: rows.length, recipient: to });
  } catch (e) { return json({ error: e.message }, 500); }
}
