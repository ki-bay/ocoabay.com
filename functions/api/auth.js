// Auth API.
//   GET  /api/auth                      -> current customer (or null)
//   POST /api/auth {action:'signup', name, email, password}
//   POST /api/auth {action:'login', email, password}
//   POST /api/auth {action:'logout'}
import { neon } from "@neondatabase/serverless";
import { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, getSessionCustomer, getCookie } from "../_lib/auth.js";

function json(d, { status = 200, cookie } = {}) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(d), { status, headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const sql = neon(env.DATABASE_URL);
    const c = await getSessionCustomer(sql, request);
    return json({ customer: c || null });
  } catch (e) { return json({ error: e.message }, { status: 500 }); }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const sql = neon(env.DATABASE_URL);
    const body = await request.json();
    const action = body.action;

    if (action === "logout") {
      const token = getCookie(request, "sid");
      if (token) await sql`delete from sessions where token = ${token}`;
      return json({ ok: true }, { cookie: clearCookie() });
    }

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Valid email required" }, { status: 400 });
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, { status: 400 });

    if (action === "signup") {
      const exists = await sql`select 1 from customers where email = ${email} limit 1`;
      if (exists.length) return json({ error: "An account with this email already exists" }, { status: 409 });
      const hash = await hashPassword(password);
      const rows = await sql`insert into customers (email, name, password_hash) values (${email}, ${body.name || null}, ${hash}) returning id, email, name`;
      const token = await createSession(sql, rows[0].id);
      try { const { sendWelcomeEmail } = await import("../_lib/email.js"); await sendWelcomeEmail(env, { email, name: body.name || "" }); } catch (_) {}
      return json({ ok: true, customer: rows[0] }, { cookie: sessionCookie(token) });
    }

    if (action === "login") {
      const rows = await sql`select id, email, name, password_hash from customers where email = ${email} limit 1`;
      const c = rows[0];
      if (!c || !c.password_hash || !(await verifyPassword(password, c.password_hash)))
        return json({ error: "Invalid email or password" }, { status: 401 });
      const token = await createSession(sql, c.id);
      return json({ ok: true, customer: { id: c.id, email: c.email, name: c.name } }, { cookie: sessionCookie(token) });
    }

    return json({ error: "Bad action" }, { status: 400 });
  } catch (e) { return json({ error: e.message }, { status: 500 }); }
}
