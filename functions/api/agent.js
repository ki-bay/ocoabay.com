// POST /api/agent { message, conversation_id?, lang? } -> { ok, conversation_id, reply, escalated }
// Web chat entry point. Gated behind ANTHROPIC_API_KEY (graceful fallback if unset).
import { neon } from "@neondatabase/serverless";
import { runAgent } from "../_lib/agent.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function fallback(lang) {
  return lang === "es"
    ? "¡Hola! En este momento el asistente automático no está disponible. Puedes reservar en https://ocoabay.com/book/ , escribirnos por WhatsApp, o llamar al +1 (849) 876-6563. ¿Te ayudo con algo más?"
    : "Hi! Our automated assistant is offline right now. You can book at https://ocoabay.com/book/ , message us on WhatsApp, or call +1 (849) 876-6563. Anything else I can point you to?";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const b = await request.json();
    const msg = (b.message || "").toString().slice(0, 2000).trim();
    const lang = b.lang === "es" ? "es" : "en";
    if (!msg) return json({ error: "Empty message" }, 400);

    const sql = neon(env.DATABASE_URL);

    // find or create the conversation
    let convId = b.conversation_id || null;
    if (convId) {
      const c = await sql`select id from conversations where id = ${convId}`;
      if (!c.length) convId = null;
    }
    if (!convId) {
      const c = await sql`insert into conversations (channel, language) values ('web', ${lang}) returning id`;
      convId = c[0].id;
    }
    await sql`insert into messages (conversation_id, role, content) values (${convId}, 'user', ${msg})`;
    await sql`update conversations set updated_at = now() where id = ${convId}`;

    // graceful fallback when the agent isn't configured
    if (!env.ANTHROPIC_API_KEY) {
      const reply = fallback(lang);
      await sql`insert into messages (conversation_id, role, content) values (${convId}, 'assistant', ${reply})`;
      return json({ ok: true, conversation_id: convId, reply, configured: false });
    }

    // build recent history (text turns) + run the agent
    const prior = await sql`select role, content from messages where conversation_id = ${convId} and role in ('user','assistant') order by at desc limit 12`;
    const history = prior.reverse().map((m) => ({ role: m.role, content: m.content || "" }));

    const t0 = Date.now();
    const out = await runAgent(env, sql, { lang, conversationId: convId, history });
    const reply = out.text || (lang === "es" ? "Disculpa, ¿puedes reformular tu pregunta?" : "Sorry, could you rephrase that?");

    await sql`insert into messages (conversation_id, role, content) values (${convId}, 'assistant', ${reply})`;
    if (out.escalated) await sql`update conversations set status = 'handoff' where id = ${convId}`;
    try {
      await sql`insert into agent_runs (conversation_id, model, latency_ms, tools_called, escalated, input_tokens, output_tokens)
        values (${convId}, ${env.AGENT_MODEL || "claude-haiku-4-5-20251001"}, ${Date.now() - t0},
          ${JSON.stringify(out.toolsCalled || [])}, ${!!out.escalated},
          ${out.usage ? out.usage.input_tokens : null}, ${out.usage ? out.usage.output_tokens : null})`;
    } catch (_) {}

    return json({ ok: true, conversation_id: convId, reply, escalated: !!out.escalated, configured: true });
  } catch (e) { return json({ error: e.message }, 500); }
}
