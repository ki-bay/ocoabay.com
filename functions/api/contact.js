// Cloudflare Pages Function — handles contact / reservation form submissions
// and stores them in Supabase. Deployed automatically at /api/contact.
//
// Env vars (set in Cloudflare Pages → Settings → Environment variables):
//   SUPABASE_URL              e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY service role key (server-side only, never expose)

export async function onRequestPost(context) {
  const { request, env } = context;

  // Basic CORS / same-origin handling
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    let payload;
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = Object.fromEntries(form.entries());
    }

    // Minimal validation
    const name = (payload.name || "").toString().trim();
    const email = (payload.email || "").toString().trim();
    const message = (payload.message || payload.comments || "").toString().trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid email" }), {
        status: 400,
        headers: cors,
      });
    }

    // Insert into Supabase via REST (no SDK needed on the edge)
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        name,
        email,
        message,
        source_page: payload.source_page || request.headers.get("referer") || null,
        raw: payload,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ ok: false, error: "Storage failed", detail: text }), {
        status: 502,
        headers: cors,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: cors,
    });
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
