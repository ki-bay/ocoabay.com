// Customer-service digest. Call on a schedule with: Authorization: Bearer <ADMIN_TOKEN>.
// Emails the full transcript of every conversation that has gone idle (>30 min) and hasn't
// been sent yet to CS@ocoabay.com (bilingual), then closes it. Handoffs are emailed instantly
// elsewhere; this guarantees EVERY conversation reaches customer service, automated.
import { neon } from "@neondatabase/serverless";
import { emailTranscript } from "../../_lib/channels.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    await sql`alter table conversations add column if not exists transcript_sent_at timestamptz`;

    const idle = await sql`select id, channel, external_id from conversations
      where transcript_sent_at is null and updated_at < now() - interval '30 minutes'
        and exists (select 1 from messages m where m.conversation_id = conversations.id)
      order by updated_at limit 100`;

    let sent = 0;
    for (const c of idle) {
      try { await emailTranscript(env, sql, c.id, c.channel, c.external_id, "digest"); sent++; } catch (_) {}
      // close web/open conversations; leave handoff status intact for the agent queue
      await sql`update conversations set status = case when status = 'open' then 'closed' else status end where id = ${c.id}`;
    }
    return json({ ok: true, transcripts_sent: sent, recipient: env.TRANSCRIPT_EMAIL || "CS@ocoabay.com" });
  } catch (e) { return json({ error: e.message }, 500); }
}
