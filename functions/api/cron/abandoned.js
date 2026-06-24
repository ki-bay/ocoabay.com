// Abandoned-cart reminder job. Call on a schedule (Cloudflare Cron Worker or
// any scheduler) with header: Authorization: Bearer <ADMIN_TOKEN>.
// Finds carts with items, an email, untouched > 1h, not yet reminded → emails them.
import { neon } from "@neondatabase/serverless";
import { priceCart } from "../../_lib/pricing.js";
import { sendEmail } from "../../_lib/email.js";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function onRequest(context) {
  const { request, env } = context;
  const h = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || h !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const carts = await sql`select id, items, email, coupon_code, country from carts
      where email is not null and jsonb_array_length(items) > 0
        and reminded_at is null and updated_at < now() - interval '1 hour' limit 50`;
    let sent = 0;
    for (const c of carts) {
      const priced = await priceCart(sql, c.items, { couponCode: c.coupon_code, country: c.country });
      if (!priced.lines.length) continue;
      await sendEmail(env, {
        to: c.email,
        subject: "You left something in your cart — OcoaBay",
        html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto">
          <h2 style="color:#6b3f2a">Still thinking it over?</h2>
          <p>Your cart is waiting with ${priced.count} item(s). <a href="https://ocoabay.com/cart/">Return to your cart →</a></p></div>`,
      });
      await sql`update carts set reminded_at = now() where id = ${c.id}`;
      sent++;
    }
    return json({ ok: true, reminded: sent, candidates: carts.length });
  } catch (e) { return json({ error: e.message }, 500); }
}
