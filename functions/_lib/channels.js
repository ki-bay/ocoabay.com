// Shared omnichannel logic: normalises any inbound message into the same conversation +
// agent loop used by web chat. Thin per-channel adapters call handleInbound().
import { runAgent } from "./agent.js";

export function detectLang(text, fallback) {
  if (fallback) return fallback;
  var t = (text || "").toLowerCase();
  if (/[áéíóúñ¿¡]/.test(t) || /\b(hola|gracias|cu[aá]nto|precio|reserva|disponib|buenas|por favor|d[ií]a)\b/.test(t)) return "es";
  return "en";
}

function offline(lang) {
  return lang === "es"
    ? "¡Hola! En este momento el asistente no está disponible. Reserva en https://ocoabay.com/book/ o llama al +1 (849) 876-6563."
    : "Hi! Our assistant is offline right now. Book at https://ocoabay.com/book/ or call +1 (849) 876-6563.";
}

// Meta (WhatsApp/Instagram) webhook signature check: X-Hub-Signature-256: sha256=<hmac>.
export async function verifyMeta(rawBody, header, appSecret) {
  if (!appSecret) return true;            // not configured (dev) → allow
  if (!header) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = "sha256=" + hex;
  if (expected.length !== header.length) return false;
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

export async function handleInbound(env, sql, { channel, externalId, text, name }) {
  let conv = await sql`select id, language, status from conversations where channel = ${channel} and external_id = ${externalId}`;
  let convId, lang;
  if (conv.length) { convId = conv[0].id; lang = conv[0].language || "en"; }
  else {
    lang = detectLang(text);
    const c = await sql`insert into conversations (channel, external_id, language) values (${channel}, ${externalId}, ${lang}) returning id`;
    convId = c[0].id;
    if (name) { try { await sql`insert into customers (email, name) values (${channel + ":" + externalId}, ${name}) on conflict (email) do nothing`; } catch (_) {} }
  }
  await sql`insert into messages (conversation_id, role, content) values (${convId}, 'user', ${text})`;
  await sql`update conversations set updated_at = now() where id = ${convId}`;

  let reply, escalated = false;
  if (!env.ANTHROPIC_API_KEY) {
    reply = offline(lang);
  } else {
    const prior = await sql`select role, content from messages where conversation_id = ${convId} and role in ('user','assistant') order by at desc limit 12`;
    const history = prior.reverse().map((m) => ({ role: m.role, content: m.content || "" }));
    const t0 = Date.now();
    const out = await runAgent(env, sql, { lang, conversationId: convId, history });
    reply = out.text || offline(lang); escalated = out.escalated;
    try {
      await sql`insert into agent_runs (conversation_id, model, latency_ms, tools_called, escalated)
        values (${convId}, ${env.AGENT_MODEL || "claude-haiku-4-5-20251001"}, ${Date.now() - t0}, ${JSON.stringify(out.toolsCalled || [])}, ${!!escalated})`;
    } catch (_) {}
  }
  await sql`insert into messages (conversation_id, role, content) values (${convId}, 'assistant', ${reply})`;
  if (escalated) {
    await sql`update conversations set status = 'handoff' where id = ${convId}`;
    try { await emailTranscript(env, sql, convId, channel, externalId, "handoff"); } catch (_) {}
  }
  return { convId, reply, escalated, lang };
}

// Emails the full conversation transcript to customer service (bilingual). Used on human-handoff
// and by the idle-conversation digest cron. Dedupes via conversations.transcript_sent_at.
export async function emailTranscript(env, sql, convId, channel, externalId, reason) {
  const to = env.TRANSCRIPT_EMAIL || "CS@ocoabay.com";
  const conv = await sql`select language, status from conversations where id = ${convId}`;
  if (!conv.length) return;
  const lang = conv[0].language || "en";
  const msgs = await sql`select role, content, at from messages where conversation_id = ${convId} order by at`;
  if (!msgs.length) return;
  const fmt = (d) => new Intl.DateTimeFormat("es-DO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(d));
  const rows = msgs.map((m) =>
    `<p style="margin:6px 0"><small style="color:#999">${fmt(m.at)}</small> <strong>${m.role === "user" ? "Customer / Cliente" : (m.role === "assistant" ? "Assistant / Asistente" : m.role)}:</strong> ${(m.content || "").replace(/</g, "&lt;")}</p>`).join("");
  const { sendEmail } = await import("./email.js");
  const banner = reason === "handoff"
    ? "⚠️ Needs a human / Requiere atención humana"
    : "Conversation transcript / Transcripción de conversación";
  await sendEmail(env, {
    to,
    subject: `OcoaBay CS — ${channel} ${reason === "handoff" ? "(handoff)" : ""} ${externalId || "web"}`,
    html: `<div style="font-family:Georgia,serif;max-width:640px;color:#2b1a12">
      <h3 style="color:#6b3f2a">${banner}</h3>
      <p style="color:#777">Channel / Canal: <strong>${channel}</strong> · Contact / Contacto: ${externalId || "web visitor"} · Language / Idioma: ${lang} · Status: ${conv[0].status}</p>
      <hr style="border:0;border-top:1px solid #eee">${rows}</div>`,
  });
  await sql`update conversations set transcript_sent_at = now() where id = ${convId}`;
}

// Outbound senders (no-op until creds set).
export async function waSend(env, to, text) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return;
  await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}
export async function igSend(env, to, text) {
  if (!env.INSTAGRAM_TOKEN || !env.IG_ACCOUNT_ID) return;
  await fetch(`https://graph.facebook.com/v21.0/${env.IG_ACCOUNT_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env.INSTAGRAM_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: to }, message: { text } }),
  });
}
