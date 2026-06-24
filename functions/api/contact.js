// Cloudflare Pages Function — handles contact / reservation form submissions
// and stores them in Neon Postgres. Deployed automatically at /api/contact.
//
// Env var (set via the Cloudflare Neon integration, or Pages → Settings → env):
//   DATABASE_URL   Neon pooled connection string (kept secret, never in code)

import { neon } from "@neondatabase/serverless";

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  try {
    let payload;
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = Object.fromEntries(form.entries());
    }

    const name = (payload.name || "").toString().trim();
    const email = (payload.email || "").toString().trim();
    const message = (payload.message || payload.comments || "").toString().trim();
    const source_page = payload.source_page || request.headers.get("referer") || null;

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid email" }), { status: 400, headers: cors });
    }

    const sql = neon(env.DATABASE_URL);
    await sql`insert into submissions (name, email, message, source_page, raw)
              values (${name}, ${email}, ${message}, ${source_page}, ${JSON.stringify(payload)})`;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
