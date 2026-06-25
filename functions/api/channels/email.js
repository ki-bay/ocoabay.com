// Inbound email webhook (e.g. Postmark inbound, or a Cloudflare Email Worker that POSTs JSON).
// POST /api/channels/email?token=<POSTMARK_INBOUND_TOKEN>
// Body: { From, FromName?, Subject?, TextBody?, StrippedTextReply? }
import { neon } from "@neondatabase/serverless";
import { handleInbound } from "../../_lib/channels.js";

export async function onRequestPost({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (!env.POSTMARK_INBOUND_TOKEN || token !== env.POSTMARK_INBOUND_TOKEN)
    return new Response("Unauthorized", { status: 401 });

  let m; try { m = await request.json(); } catch { return new Response("bad", { status: 400 }); }
  const from = (m.From || "").trim();
  const text = (m.StrippedTextReply || m.TextBody || "").trim();
  if (!from || !text) return new Response("ignored");

  try {
    const sql = neon(env.DATABASE_URL);
    const out = await handleInbound(env, sql, { channel: "email", externalId: from.toLowerCase(), text, name: m.FromName });
    const { sendEmail } = await import("../../_lib/email.js");
    await sendEmail(env, { to: from, subject: "Re: " + (m.Subject || "Your OcoaBay enquiry"),
      html: `<div style="font-family:Georgia,serif;max-width:560px">${(out.reply || "").replace(/\n/g, "<br>")}</div>` });
    return new Response("ok");
  } catch (e) { return new Response("ok"); }
}
