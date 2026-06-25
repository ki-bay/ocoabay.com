// GET /api/fx -> current USD->DOP rate for the booking UI. Public, cached briefly.
import { neon } from "@neondatabase/serverless";
export async function onRequestGet({ env }) {
  try {
    const sql = neon(env.DATABASE_URL);
    const r = await sql`select rate, updated_at from fx_rates where pair = 'USD_DOP'`;
    const rate = r.length ? Number(r[0].rate) : 60;
    return new Response(JSON.stringify({ usd_dop: rate, updated_at: r.length ? r[0].updated_at : null }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" } });
  } catch (e) {
    return new Response(JSON.stringify({ usd_dop: 60, error: e.message }), { headers: { "Content-Type": "application/json" } });
  }
}
