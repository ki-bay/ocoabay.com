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
        r.party_size, r.total_cents, r.currency, s.name_en service, s.slug, a.starts_at, a.label
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
      let rows = [];
      if (type === "customers") rows = await sql`select id, created_at, email, name, phone, country, language, marketing_consent from customers order by created_at desc`;
      else if (type === "reservations") rows = await sql`select id, created_at, state, email, name, phone, experience, arrival_date, party_size, total_cents, currency from reservations order by created_at desc`;
      else if (type === "orders") rows = await sql`select id, created_at, status, email, name, total_cents, currency, coupon_code, tracking from orders order by created_at desc`;
      else return json({ error: "type must be customers|reservations|orders" }, 400);
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${type}.csv"`, "Cache-Control": "no-store" } });
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
      const rows = await sql`select state, slot_id, party_size from reservations where id = ${body.id}`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      const r = rows[0];
      const wasActive = ["confirmed", "pending_payment"].includes(r.state);
      const nowReleased = ["cancelled", "expired"].includes(body.state);
      if (wasActive && nowReleased && r.slot_id && r.party_size)
        await sql`update availability_slots set booked = greatest(0, booked - ${r.party_size}) where id = ${r.slot_id}`;
      await sql`update reservations set state = ${body.state}, status = ${body.state} where id = ${body.id}`;
      await sql`insert into reservation_events (reservation_id, from_state, to_state, actor) values (${body.id}, ${r.state}, ${body.state}, 'admin')`;
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
