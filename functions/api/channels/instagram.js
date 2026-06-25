// Instagram (Messenger Graph) webhook.
//   GET  -> Meta verification
//   POST -> inbound DM -> agent -> reply via Graph send API
import { neon } from "@neondatabase/serverless";
import { handleInbound, verifyMeta, igSend } from "../../_lib/channels.js";

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (u.searchParams.get("hub.mode") === "subscribe" &&
      u.searchParams.get("hub.verify_token") === env.META_VERIFY_TOKEN) {
    return new Response(u.searchParams.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (!(await verifyMeta(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)))
    return new Response("bad signature", { status: 403 });

  let body; try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  try {
    const sql = neon(env.DATABASE_URL);
    for (const e of (body.entry || [])) {
      for (const m of (e.messaging || [])) {
        if (!m.message || !m.message.text || (m.message.is_echo)) continue;
        const from = m.sender && m.sender.id;
        if (!from) continue;
        const out = await handleInbound(env, sql, { channel: "instagram", externalId: from, text: m.message.text });
        await igSend(env, from, out.reply);
      }
    }
    return new Response("ok");
  } catch (e) { return new Response("ok"); }
}
