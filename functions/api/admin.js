// Admin order management — requires Authorization: Bearer <ADMIN_TOKEN>.
//   GET  /api/admin?view=orders
//   POST /api/admin {action:'status', id, status}
//   POST /api/admin {action:'tracking', id, tracking}
import { neon } from "@neondatabase/serverless";

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const STATUSES = ["pending_payment", "processing", "completed", "shipped", "cancelled", "refunded"];

function authed(request, env) {
  const h = request.headers.get("Authorization") || "";
  return env.ADMIN_TOKEN && h === `Bearer ${env.ADMIN_TOKEN}`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const view = new URL(request.url).searchParams.get("view");
    if (view === "reservations") {
      const reservations = await sql`select id, created_at, experience, name, email, phone,
        arrival_date, people, message, status from reservations where service_id is null order by created_at desc limit 300`;
      return json({ reservations, resv_statuses: ["new", "confirmed", "completed", "cancelled"] });
    }
    if (view === "bookings") {
      const bookings = await sql`select r.id, r.created_at, r.state, r.email, r.name, r.phone,
        r.party_size, r.total_cents, r.deposit_cents, r.balance_cents, r.pay_mode, r.pay_currency,
        s.name_en service, s.slug, a.starts_at, a.label
        from reservations r
        left join services s on s.id = r.service_id
        left join availability_slots a on a.id = r.slot_id
        where r.service_id is not null order by r.created_at desc limit 300`;
      return json({ bookings, states: ["pending_payment", "confirmed", "completed", "cancelled", "expired"] });
    }
    if (view === "conversations") {
      const conversations = await sql`select c.id, c.channel, c.status, c.language, c.created_at, c.updated_at,
        (select count(*) from messages m where m.conversation_id = c.id)::int msgs,
        (select content from messages m where m.conversation_id = c.id and m.role = 'user' order by m.at desc limit 1) last_user
        from conversations c order by (c.status = 'handoff') desc, c.updated_at desc limit 200`;
      return json({ conversations });
    }
    if (view === "conversation") {
      const id = new URL(request.url).searchParams.get("id");
      const messages = await sql`select role, content, at from messages where conversation_id = ${id} order by at`;
      return json({ messages });
    }
    if (view === "export") {
      const type = new URL(request.url).searchParams.get("type");
      let rows = [], cols = [];
      if (type === "customers") { rows = await sql`select id, created_at, email, name, phone, country, language, marketing_consent from customers order by created_at desc`; cols = ["id", "created_at", "email", "name", "phone", "country", "language", "marketing_consent"]; }
      else if (type === "reservations") { rows = await sql`select id, created_at, state, email, name, phone, experience, arrival_date, party_size, total_cents, currency from reservations order by created_at desc`; cols = ["id", "created_at", "state", "email", "name", "phone", "experience", "arrival_date", "party_size", "total_cents", "currency"]; }
      else if (type === "orders") { rows = await sql`select id, created_at, status, email, name, total_cents, currency, coupon_code, tracking from orders order by created_at desc`; cols = ["id", "created_at", "status", "email", "name", "total_cents", "currency", "coupon_code", "tracking"]; }
      else return json({ error: "type must be customers|reservations|orders" }, 400);
      const esc = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${type}.csv"`, "Cache-Control": "no-store" } });
    }
    if (view === "attendance") {
      const u = new URL(request.url);
      let from = u.searchParams.get("from"), to = u.searchParams.get("to");
      if (!from) from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const punches = await sql`select device_user_id, punched_at, status from device_punches
        where (punched_at at time zone 'America/Santo_Domingo')::date >= ${from}::date
          and (${to}::text is null or (punched_at at time zone 'America/Santo_Domingo')::date <= ${to}::date)
        order by device_user_id, punched_at`;

      const LEGAL = 44; // DR legal weekly hours
      const drDate = (ts) => new Date(new Date(ts).getTime() - 4 * 3600000).toISOString().slice(0, 10);
      const weekKey = (ds) => { const dt = new Date(ds + "T00:00:00Z"); const m = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - m); return dt.toISOString().slice(0, 10); };
      const r2 = (n) => Math.round(n * 100) / 100;
      const byUser = {};
      for (const p of punches) (byUser[p.device_user_id] = byUser[p.device_user_id] || []).push(p);

      const employees = [];
      for (const uid of Object.keys(byUser).sort()) {
        const ps = byUser[uid].sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));
        const dayHours = {}, weekHours = {}, pairs = [];
        for (let i = 0; i + 1 < ps.length; i += 2) {
          const ci = new Date(ps[i].punched_at), co = new Date(ps[i + 1].punched_at);
          const hrs = Math.max(0, (co - ci) / 3600000);
          const d = drDate(ps[i].punched_at);
          dayHours[d] = (dayHours[d] || 0) + hrs;
          weekHours[weekKey(d)] = (weekHours[weekKey(d)] || 0) + hrs;
          pairs.push({ date: d, in: ci.toISOString(), out: co.toISOString(), hours: r2(hrs) });
        }
        const total = Object.values(dayHours).reduce((a, b) => a + b, 0);
        const ot = Object.values(weekHours).reduce((a, h) => a + Math.max(0, h - LEGAL), 0);
        employees.push({
          device_user_id: uid, days: Object.keys(dayHours).length,
          total_hours: r2(total), regular_hours: r2(total - ot), overtime_hours: r2(ot),
          open_punch: ps.length % 2 === 1, pairs,
          daily: Object.keys(dayHours).sort().map((d) => ({ date: d, hours: r2(dayHours[d]) })),
        });
      }
      return json({ from, to: to || null, legal_week_hours: LEGAL, employees });
    }
    if (view === "availability") {
      const u = new URL(request.url);
      const slug = u.searchParams.get("service");
      const slots = await sql`select a.id, a.starts_at, a.label, a.capacity, a.booked, a.held, a.status, s.slug
        from availability_slots a join services s on s.id = a.service_id
        where (${slug}::text is null or s.slug = ${slug})
          and a.starts_at > now() order by a.starts_at limit 200`;
      const services = await sql`select slug, name_en from services where active = true order by id`;
      return json({ slots, services });
    }
    const orders = await sql`select id, created_at, status, email, name, total_cents, currency,
      coupon_code, tracking, items from orders order by created_at desc limit 200`;
    const stats = await sql`select status, count(*)::int n, coalesce(sum(total_cents),0)::int rev from orders group by status`;
    const resvCount = await sql`select count(*)::int n from reservations where status = 'new'`;
    return json({ orders, stats, statuses: STATUSES, new_reservations: resvCount[0].n });
  } catch (e) { return json({ error: e.message }, 500); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Unauthorized" }, 401);
  try {
    const sql = neon(env.DATABASE_URL);
    const body = await request.json();
    if (body.action === "status") {
      if (!STATUSES.includes(body.status)) return json({ error: "Bad status" }, 400);
      const paid = body.status === "completed" || body.status === "processing";
      await sql`update orders set status = ${body.status}, paid_at = case when ${paid} and paid_at is null then now() else paid_at end where id = ${body.id}`;
      return json({ ok: true });
    }
    if (body.action === "tracking") {
      await sql`update orders set tracking = ${body.tracking || null} where id = ${body.id}`;
      return json({ ok: true });
    }
    if (body.action === "resv_status") {
      const allowed = ["new", "confirmed", "completed", "cancelled"];
      if (!allowed.includes(body.status)) return json({ error: "Bad status" }, 400);
      await sql`update reservations set status = ${body.status} where id = ${body.id}`;
      return json({ ok: true });
    }
    if (body.action === "booking_state") {
      const allowed = ["pending_payment", "confirmed", "completed", "cancelled", "expired"];
      if (!allowed.includes(body.state)) return json({ error: "Bad state" }, 400);
      const rows = await sql`select state, slot_id, club_slot_id, party_size from reservations where id = ${body.id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const r = rows[0];
      const wasActive = ["confirmed", "pending_payment"].includes(r.state);
      const nowReleased = ["cancelled", "expired"].includes(body.state);
      if (wasActive && nowReleased && r.party_size) {
        if (r.slot_id) await sql`update availability_slots set booked = greatest(0, booked - ${r.party_size}) where id = ${r.slot_id}`;
        if (r.club_slot_id) await sql`update availability_slots set booked = greatest(0, booked - ${r.party_size}) where id = ${r.club_slot_id}`;
      }
      await sql`update reservations set state = ${body.state}, status = ${body.state} where id = ${body.id}`;
      await sql`insert into reservation_events (reservation_id, from_state, to_state, actor) values (${body.id}, ${r.state}, ${body.state}, 'admin')`;
      return json({ ok: true });
    }
    if (body.action === "cs_booking") {
      const { getService, priceBooking, stripeApi } = await import("../_lib/booking.js");
      const email = (body.email || "").trim(), name = (body.name || "").trim();
      const lang = body.language === "es" ? "es" : "en";
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Name and valid email required" }, 400);
      const svc = await getService(sql, body.service);
      if (!svc) return json({ error: "Unknown service" }, 400);
      const qty = Math.max(1, parseInt(body.party_size, 10) || 1);

      // atomic reserve (session)
      const upd = await sql`update availability_slots set booked = booked + ${qty}
        where id = ${body.slot_id} and service_id = ${svc.id} and status = 'open' and starts_at > now()
          and booked + held + ${qty} <= capacity returning starts_at`;
      if (!upd.length) return json({ ok: false, error: "Slot unavailable for that party size" }, 409);
      const arrival = new Date(upd[0].starts_at).toISOString().slice(0, 10);

      // tour bookings also consume the Club House day pool
      let clubSlotId = null;
      if (svc.config && svc.config.uses_clubhouse) {
        const ch = await sql`update availability_slots a set booked = a.booked + ${qty}
          from services s where s.id = a.service_id and s.slug = 'club-house' and a.status = 'open'
            and (a.starts_at at time zone 'America/Santo_Domingo')::date = ${arrival}::date
            and a.booked + a.held + ${qty} <= a.capacity returning a.id`;
        if (!ch.length) {
          await sql`update availability_slots set booked = greatest(0, booked - ${qty}) where id = ${body.slot_id}`;
          return json({ ok: false, error: "Club House is full for that date" }, 409);
        }
        clubSlotId = ch[0].id;
      }
      const price = await priceBooking(sql, svc, qty, []);
      const payMode = (svc.config && svc.config.payment) || "full";

      let cust = await sql`select id from customers where email = ${email}`;
      if (!cust.length) cust = await sql`insert into customers (email, name, phone, language) values (${email}, ${name}, ${body.phone || null}, ${lang}) returning id`;
      const state = payMode === "none" ? "confirmed" : "pending_payment";

      const ins = await sql`insert into reservations
        (experience, name, email, phone, arrival_date, people, status, customer_id, service_id, slot_id, club_slot_id, state,
         party_size, details, language, subtotal_cents, tax_cents, service_charge_cents, total_cents, source, raw)
        values (${svc.name_en}, ${name}, ${email}, ${body.phone || null}, ${arrival}, ${qty}, ${state}, ${cust[0].id}, ${svc.id}, ${body.slot_id}, ${clubSlotId}, ${state},
         ${qty}, ${JSON.stringify(body.details || {})}, ${lang}, ${price.subtotal_cents}, ${price.tax_cents}, ${price.service_charge_cents}, ${price.total_cents}, 'cs', ${JSON.stringify({ by: "cs" })})
        returning id`;
      const rid = ins[0].id;
      await sql`insert into reservation_events (reservation_id, from_state, to_state, actor) values (${rid}, null, ${state}, 'cs')`;
      const elib = await import("../_lib/email.js");

      if (state === "confirmed") { try { await elib.sendBookingEmail(env, { sql, reservationId: rid }); } catch (_) {} return json({ ok: true, reservation_id: rid, state, payment: "none" }); }

      await sql`insert into payments (reservation_id, kind, amount_cents, currency, status, idempotency_key) values (${rid}, 'full', ${price.total_cents}, ${price.currency}, 'pending', ${rid + ":full"})`;
      if (env.STRIPE_SECRET_KEY) {
        const sess = await stripeApi(env, "checkout/sessions", {
          mode: "payment", success_url: "https://ocoabay.com/book/?paid=1", cancel_url: "https://ocoabay.com/book/?cancel=1",
          customer_email: email,
          "line_items[0][quantity]": "1",
          "line_items[0][price_data][currency]": price.currency.toLowerCase(),
          "line_items[0][price_data][unit_amount]": String(price.total_cents),
          "line_items[0][price_data][product_data][name]": `${svc.name_en} ×${qty} — ${arrival}`,
          "payment_intent_data[metadata][reservation_id]": String(rid),
          "metadata[reservation_id]": String(rid),
        });
        if (sess && sess.url) {
          try { await elib.sendPaymentLink(env, { sql, reservationId: rid, url: sess.url }); } catch (_) {}
          return json({ ok: true, reservation_id: rid, state, payment: "stripe", payment_url: sess.url, emailed: true });
        }
      }
      try { await elib.sendBookingEmail(env, { sql, reservationId: rid, arrange: true }); } catch (_) {}
      return json({ ok: true, reservation_id: rid, state, payment: "arrange" });
    }
    if (body.action === "send_message") {
      const c = await sql`select id, channel, external_id from conversations where id = ${body.id}`;
      if (!c.length) return json({ error: "Conversation not found" }, 404);
      const conv = c[0];
      const text = (body.text || "").toString().slice(0, 2000).trim();
      if (!text) return json({ error: "Empty message" }, 400);
      await sql`insert into messages (conversation_id, role, content) values (${conv.id}, 'agent_human', ${text})`;
      await sql`update conversations set status = 'handoff', updated_at = now() where id = ${conv.id}`; // a human is now handling it
      try {
        if (conv.channel === "whatsapp") { const { waSend } = await import("../_lib/channels.js"); await waSend(env, conv.external_id, text); }
        else if (conv.channel === "instagram") { const { igSend } = await import("../_lib/channels.js"); await igSend(env, conv.external_id, text); }
        else if (conv.channel === "email") { const { sendEmail } = await import("../_lib/email.js"); await sendEmail(env, { to: conv.external_id, subject: "OcoaBay", html: text.replace(/\n/g, "<br>") }); }
        // 'web' chat is shown in the thread; live web reply delivery is Phase 2.
      } catch (_) {}
      return json({ ok: true });
    }
    if (body.action === "conv_status") {
      const allowed = ["open", "handoff", "closed"];
      if (!allowed.includes(body.status)) return json({ error: "Bad status" }, 400);
      await sql`update conversations set status = ${body.status}, updated_at = now() where id = ${body.id}`;
      return json({ ok: true });
    }
    if (body.action === "block_slot" || body.action === "open_slot") {
      const st = body.action === "block_slot" ? "blocked" : "open";
      await sql`update availability_slots set status = ${st} where id = ${body.slot_id}`;
      return json({ ok: true });
    }
    return json({ error: "Bad action" }, 400);
  } catch (e) { return json({ error: e.message }, 500); }
}
