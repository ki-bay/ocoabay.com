// GET /api/booking/balance?reservation_id=<uuid>
// Returns the outstanding balance for a deposit booking and (if Stripe is configured) a
// PaymentIntent client_secret so the customer can pay the remaining 75% before arrival.
import { db, json, stripeApi, usdDop } from "../../_lib/booking.js";

export async function onRequestGet({ request, env }) {
  try {
    const sql = db(env);
    const id = new URL(request.url).searchParams.get("reservation_id");
    if (!id) return json({ error: "reservation_id required" }, 400);
    const rows = await sql`select r.id, r.email, r.name, r.language, r.balance_cents, r.pay_currency,
      r.party_size, s.name_en, s.name_es, a.starts_at
      from reservations r join services s on s.id = r.service_id join availability_slots a on a.id = r.slot_id
      where r.id = ${id}`;
    if (!rows.length) return json({ error: "Reservation not found" }, 404);
    const r = rows[0];
    if (!r.balance_cents || r.balance_cents <= 0) return json({ ok: true, paid: true });

    const currency = r.pay_currency === "DOP" ? "DOP" : "USD";
    let amount = r.balance_cents; // USD cents
    if (currency === "DOP") amount = Math.round(r.balance_cents * (await usdDop(sql)));

    const info = {
      ok: true, paid: false, reservation_id: r.id, name: r.name, currency,
      amount, balance_usd_cents: r.balance_cents, language: r.language,
      service: r.language === "es" ? r.name_es : r.name_en, starts_at: new Date(r.starts_at).toISOString(),
    };

    if (env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY) {
      const pi = await stripeApi(env, "payment_intents", {
        amount: String(amount), currency: currency.toLowerCase(),
        "automatic_payment_methods[enabled]": "true",
        "metadata[reservation_id]": String(r.id), "metadata[kind]": "balance",
        ...(r.email ? { receipt_email: r.email } : {}),
      });
      if (pi && !pi.error) {
        const ex = await sql`select id from payments where reservation_id = ${r.id} and kind = 'balance'`;
        if (ex.length) await sql`update payments set amount_cents = ${amount}, currency = ${currency}, status = 'pending', stripe_payment_intent = ${pi.id} where id = ${ex[0].id}`;
        else await sql`insert into payments (reservation_id, kind, amount_cents, currency, status, idempotency_key, stripe_payment_intent)
          values (${r.id}, 'balance', ${amount}, ${currency}, 'pending', ${r.id + ":balance"}, ${pi.id})`;
        return json({ ...info, enabled: true, client_secret: pi.client_secret, publishable_key: env.STRIPE_PUBLISHABLE_KEY });
      }
    }
    return json({ ...info, enabled: false }); // no Stripe -> pay on arrival / contact
  } catch (e) { return json({ error: e.message }, 500); }
}
