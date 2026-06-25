// Autonomous operations report. Call with Authorization: Bearer <ADMIN_TOKEN>.
// Emails a 24h digest + ANOMALIES to ops/CS. If anomalies==0 the automation just keeps running;
// if >0, a human reviews those specific items in the in-panel inbox and fixes what's real.
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const n0 = (r) => (r && r[0] && r[0].n) || 0;

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);

    // 24h activity
    const convs = await sql`select channel, count(*)::int n from conversations where created_at > now() - interval '24 hours' group by channel`;
    const msgs = n0(await sql`select count(*)::int n from messages where at > now() - interval '24 hours'`);
    const runs = await sql`select count(*)::int n, coalesce(sum(case when escalated then 1 else 0 end),0)::int esc from agent_runs where at > now() - interval '24 hours'`;
    const bkByState = await sql`select state, count(*)::int n from reservations where created_at > now() - interval '24 hours' and service_id is not null group by state`;
    const orders24 = n0(await sql`select count(*)::int n from orders where created_at > now() - interval '24 hours'`);

    // anomalies
    const handoff = await sql`select channel, external_id, (select content from messages m where m.conversation_id=c.id and m.role='user' order by m.at desc limit 1) last from conversations c where status='handoff' order by updated_at desc limit 20`;
    const stalePending = n0(await sql`select count(*)::int n from reservations where state='pending_payment' and service_id is not null and created_at < now() - interval '2 hours'`);
    const payFail = n0(await sql`select count(*)::int n from payments where status='failed' and created_at > now() - interval '24 hours'`);
    const balanceToday = n0(await sql`select count(*)::int n from reservations where balance_cents>0 and state in ('confirmed','pending_payment') and arrival_date = (now() at time zone 'America/Santo_Domingo')::date`);

    const anomalies = [];
    if (handoff.length) anomalies.push(`${handoff.length} conversation(s) escalated to a human`);
    if (stalePending) anomalies.push(`${stalePending} booking(s) stuck in pending_payment > 2h`);
    if (payFail) anomalies.push(`${payFail} failed payment(s) in 24h`);
    if (balanceToday) anomalies.push(`${balanceToday} booking(s) today still owe a balance`);

    const to = env.OPS_EMAIL || env.CS_EMAIL || "CS@ocoabay.com";
    const row = (a, b) => `<tr><td>${a}</td><td align="right">${b}</td></tr>`;
    const html = `<div style="font-family:Georgia,serif;max-width:640px;color:#2b1a12">
      <h3 style="color:#74181B">OcoaBay — Operations report (last 24h)</h3>
      <p style="font-size:16px"><strong>${anomalies.length ? "⚠️ " + anomalies.length + " item(s) need a look" : "✅ All clear — automation running normally"}</strong></p>
      ${anomalies.length ? "<ul>" + anomalies.map((a) => `<li>${a}</li>`).join("") + "</ul>" : ""}
      ${handoff.length ? `<p><strong>Escalated chats:</strong></p><ul>${handoff.map((x) => `<li>${x.channel} · ${x.external_id || "web"} — "${(x.last || "").slice(0, 60)}"</li>`).join("")}</ul>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row("Conversations (24h)", convs.reduce((a, c) => a + c.n, 0) + (convs.length ? " (" + convs.map((c) => c.channel + ":" + c.n).join(", ") + ")" : ""))}
        ${row("Messages (24h)", msgs)}
        ${row("AI runs (24h)", (runs[0] ? runs[0].n : 0) + " · escalated " + (runs[0] ? runs[0].esc : 0))}
        ${row("Bookings (24h)", bkByState.map((b) => b.state + ":" + b.n).join(", ") || "0")}
        ${row("Store orders (24h)", orders24)}
      </table>
      <p style="font-size:12px;color:#777;margin-top:14px">No action needed if all clear. Otherwise open the admin inbox to review the flagged items.</p></div>`;

    let emailed = false;
    try { const { sendEmail } = await import("../../_lib/email.js"); await sendEmail(env, { to, subject: `OcoaBay ops — ${anomalies.length ? anomalies.length + " to review" : "all clear"}`, html }); emailed = true; } catch (_) {}

    return json({ ok: true, anomalies: anomalies.length, escalated: handoff.length, stale_pending: stalePending, failed_payments: payFail, balance_today: balanceToday, recipient: to, emailed });
  } catch (e) { return json({ error: e.message }, 500); }
}
