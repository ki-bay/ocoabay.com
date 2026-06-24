// GET /api/coupon?code=XXX&subtotal=CENTS — validate a coupon, return its effect.
import { neon } from "@neondatabase/serverless";
import { validateCoupon } from "../_lib/pricing.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const subtotal = parseInt(url.searchParams.get("subtotal") || "0", 10);
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!code) return json({ error: "code required" }, 400);
  try {
    const sql = neon(env.DATABASE_URL);
    const v = await validateCoupon(sql, code, subtotal);
    if (v?.error) return json({ valid: false, error: v.error });
    return json({ valid: true, coupon: { code: v.coupon.code, type: v.coupon.type, amount: Number(v.coupon.amount), free_shipping: v.coupon.free_shipping } });
  } catch (e) { return json({ error: e.message }, 500); }
}
