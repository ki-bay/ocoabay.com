// WhatsApp Cloud API webhook.
//   GET  -> Meta verification (hub.challenge)
//   POST -> inbound message -> agent -> reply via Cloud API
import { neon } from "@neondatabase/serverless";
import { handleInbound, verifyMeta, waSend } from "../../_lib/channels.js";

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
    const entries = body.entry || [];
    for (const e of entries) {
      for (const ch of (e.changes || [])) {
        const v = ch.value || {};
        const msg = (v.messages || [])[0];
        if (!msg || msg.type !== "text") continue;             // ignore status callbacks / non-text
        const from = msg.from;
        const text = msg.text && msg.text.body;
        const name = ((v.contacts || [])[0] || {}).profile && v.contacts[0].profile.name;
        const out = await handleInbound(env, sql, { channel: "whatsapp", externalId: from, text, name });
        await waSend(env, from, out.reply);
      }
    }
    return new Response("ok");
  } catch (e) { return new Response("ok"); }  // always 200 so Meta doesn't retry-storm
}
