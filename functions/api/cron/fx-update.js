// Daily USD->DOP exchange-rate refresh. Call with Authorization: Bearer <ADMIN_TOKEN>.
// Source: open.er-api.com (free, no key). Keeps the last good rate if the fetch fails.
import { neon } from "@neondatabase/serverless";
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const src = env.FX_SOURCE_URL || "https://open.er-api.com/v6/latest/USD";
    const r = await fetch(src, { headers: { "User-Agent": "OcoaBay" } });
    const d = await r.json();
    const rate = d && d.rates && d.rates.DOP;
    if (!rate || !(rate > 0)) return json({ ok: false, error: "no DOP rate in source" }, 502);
    await sql`insert into fx_rates(pair, rate, updated_at) values('USD_DOP', ${rate}, now())
      on conflict (pair) do update set rate = excluded.rate, updated_at = now()`;
    return json({ ok: true, usd_dop: rate });
  } catch (e) { return json({ error: e.message }, 500); }
}
