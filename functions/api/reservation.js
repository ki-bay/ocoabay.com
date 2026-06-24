// POST /api/reservation — booking request for an experience → Neon.
// Body: { experience, name, email, phone, arrival_date, people, message }
import { neon } from "@neondatabase/serverless";

export async function onRequestPost(context) {
  const { request, env } = context;
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    const ct = request.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await request.json() : Object.fromEntries((await request.formData()).entries());

    const name = (body.name || "").toString().trim();
    const email = (body.email || "").toString().trim();
    if (!name) return json({ ok: false, error: "Name required" }, 400);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "Valid email required" }, 400);

    const people = parseInt(body.people, 10);
    const arrival = body.arrival_date && /^\d{4}-\d{2}-\d{2}$/.test(body.arrival_date) ? body.arrival_date : null;

    const sql = neon(env.DATABASE_URL);
    const rows = await sql`insert into reservations (experience, name, email, phone, arrival_date, people, message, raw)
      values (${body.experience || null}, ${name}, ${email}, ${body.phone || null}, ${arrival},
        ${Number.isFinite(people) ? people : null}, ${body.message || null}, ${JSON.stringify(body)})
      returning id`;

    // Notify (no-op until RESEND_API_KEY set)
    try {
      const { sendEmail } = await import("../_lib/email.js");
      await sendEmail(env, { to: email, subject: "Your OcoaBay reservation request",
        html: `<div style="font-family:Georgia,serif"><h2 style="color:#6b3f2a">Thank you, ${name}!</h2>
        <p>We received your request for <strong>${body.experience || "an experience"}</strong>${arrival ? ` on ${arrival}` : ""}${Number.isFinite(people) ? ` for ${people} guest(s)` : ""}. We'll confirm by email shortly.</p></div>` });
    } catch (_) {}

    return json({ ok: true, id: rows[0].id });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
