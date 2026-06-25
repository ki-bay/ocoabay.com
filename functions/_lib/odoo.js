// Minimal Odoo External API client (JSON-RPC) for Odoo.sh / Odoo Online.
// Gated: odooConfigured(env) is false until ODOO_URL/ODOO_DB/ODOO_USER/ODOO_API_KEY are set,
// so the attendance receiver still records punches (and replays later) without Odoo wired.
export function odooConfigured(env) {
  return !!(env.ODOO_URL && env.ODOO_DB && env.ODOO_USER && env.ODOO_API_KEY);
}

async function rpc(env, service, method, args) {
  const r = await fetch(`${env.ODOO_URL.replace(/\/$/, "")}/jsonrpc`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: 1 }),
  });
  const j = await r.json();
  if (j.error) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error.data?.message || j.error));
  return j.result;
}

export async function odooAuth(env) {
  const uid = await rpc(env, "common", "authenticate", [env.ODOO_DB, env.ODOO_USER, env.ODOO_API_KEY, {}]);
  if (!uid) throw new Error("Odoo authentication failed (check ODOO_USER / ODOO_API_KEY / ODOO_DB)");
  return uid;
}

export async function odooExec(env, uid, model, method, args, kwargs = {}) {
  return rpc(env, "object", "execute_kw", [env.ODOO_DB, uid, env.ODOO_API_KEY, model, method, args, kwargs]);
}

// Convert a DR-local "YYYY-MM-DD HH:MM:SS" punch to Odoo's naive-UTC datetime string.
export function toOdooUTC(localStr) {
  const iso = localStr.trim().replace(" ", "T") + "-04:00"; // DR = UTC-4, no DST
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

// Find a customer by email or create it. Returns res.partner id.
export async function upsertPartner(env, uid, { name, email, phone, lang, country }) {
  if (email) {
    const found = await odooExec(env, uid, "res.partner", "search_read", [[["email", "=", email]]], { fields: ["id"], limit: 1 });
    if (found.length) return found[0].id;
  }
  return odooExec(env, uid, "res.partner", "create", [{
    name: name || email || "Customer", email: email || false, phone: phone || false,
    customer_rank: 1, ...(lang ? { lang: lang === "es" ? "es_DO" : "en_US" } : {}),
  }]);
}

// Create a customer invoice (account.move, out_invoice). lines: [{name, qty, price_unit}].
// Leaves it in draft by default; set post=true to validate it.
export async function createInvoice(env, uid, partnerId, lines, { ref, post = false } = {}) {
  const invoice_line_ids = lines.map((l) => [0, 0, { name: l.name, quantity: l.qty || 1, price_unit: (l.price_unit || 0) }]);
  const id = await odooExec(env, uid, "account.move", "create", [{
    move_type: "out_invoice", partner_id: partnerId, ...(ref ? { ref } : {}), invoice_line_ids,
  }]);
  if (post) { try { await odooExec(env, uid, "account.move", "action_post", [[id]]); } catch (_) {} }
  return id;
}

// Create a CRM lead/opportunity (optional pipeline use).
export async function createLead(env, uid, { name, contact, email, phone, expected_revenue, description }) {
  return odooExec(env, uid, "crm.lead", "create", [{
    name: name || "Web enquiry", contact_name: contact || false, email_from: email || false, phone: phone || false,
    ...(expected_revenue ? { expected_revenue } : {}), ...(description ? { description } : {}),
  }]);
}

// Toggle attendance: open record -> set check_out; else create check_in. Maps device user id to
// hr.employee via the configurable field (default: barcode). Returns {action, employee_id}.
export async function pushAttendance(env, uid, deviceUserId, odooUTC) {
  const field = env.ODOO_EMP_MATCH_FIELD || "barcode";
  const emp = await odooExec(env, uid, "hr.employee", "search_read", [[[field, "=", deviceUserId]]], { fields: ["id"], limit: 1 });
  if (!emp.length) return { action: "no_employee", device_user_id: deviceUserId };
  const empId = emp[0].id;
  const open = await odooExec(env, uid, "hr.attendance", "search_read",
    [[["employee_id", "=", empId], ["check_out", "=", false]]], { fields: ["id"], limit: 1, order: "check_in desc" });
  if (open.length) {
    await odooExec(env, uid, "hr.attendance", "write", [[open[0].id], { check_out: odooUTC }]);
    return { action: "check_out", employee_id: empId };
  }
  const id = await odooExec(env, uid, "hr.attendance", "create", [{ employee_id: empId, check_in: odooUTC }]);
  return { action: "check_in", employee_id: empId, attendance_id: id };
}
