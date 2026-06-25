// Validates the Odoo client/sync call construction against a MOCK Odoo JSON-RPC server.
// Proves the payloads (auth, partner upsert, invoice create+post, attendance) are well-formed,
// with no real Odoo needed. Run: node db/test-odoo-sync.mjs
import http from "node:http";
import { odooAuth, upsertPartner, createInvoice, pushAttendance } from "../functions/_lib/odoo.js";

const calls = [];
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const { params } = JSON.parse(body);
    let result;
    if (params.service === "common" && params.method === "authenticate") result = 7; // uid
    else if (params.service === "object" && params.method === "execute_kw") {
      const [, , , model, method, args] = params.args;
      calls.push({ model, method, args });
      if (model === "res.partner" && method === "search_read") result = [];          // not found -> create
      else if (model === "res.partner" && method === "create") result = 101;
      else if (model === "account.move" && method === "create") result = 5001;
      else if (model === "account.move" && method === "action_post") result = true;
      else if (model === "hr.employee" && method === "search_read") result = [{ id: 1 }];
      else if (model === "hr.attendance" && method === "search_read") result = [];     // no open -> create
      else if (model === "hr.attendance" && method === "create") result = 9001;
      else result = true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
});

const PASS = [], FAIL = [];
const ok = (n, c, d = "") => { (c ? PASS : FAIL).push(n); console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + d)); };

await new Promise((r) => server.listen(0, r));
const env = { ODOO_URL: `http://localhost:${server.address().port}`, ODOO_DB: "t", ODOO_USER: "u@x.com", ODOO_API_KEY: "k" };

try {
  const uid = await odooAuth(env);
  ok("auth returns uid", uid === 7, uid);

  const pid = await upsertPartner(env, uid, { name: "Ana", email: "ana@x.com", phone: "809", lang: "es" });
  ok("partner upsert returns id", pid === 101, pid);
  const sr = calls.find((c) => c.model === "res.partner" && c.method === "search_read");
  ok("partner searched by email", sr && JSON.stringify(sr.args[0]) === JSON.stringify([["email", "=", "ana@x.com"]]), JSON.stringify(sr?.args));
  const pc = calls.find((c) => c.model === "res.partner" && c.method === "create");
  ok("partner create has name/email/lang es_DO", pc && pc.args[0].email === "ana@x.com" && pc.args[0].lang === "es_DO", JSON.stringify(pc?.args[0]));

  const inv = await createInvoice(env, uid, pid, [
    { name: "Wine Tour Experience", qty: 2, price_unit: 65 },
    { name: "ITBIS 18%", qty: 1, price_unit: 23.4 },
    { name: "Propina Legal 10%", qty: 1, price_unit: 13 },
  ], { ref: "BK-abc123", post: true });
  ok("invoice create returns id", inv === 5001, inv);
  const mc = calls.find((c) => c.model === "account.move" && c.method === "create");
  const v = mc && mc.args[0];
  ok("invoice move_type=out_invoice", v && v.move_type === "out_invoice", v?.move_type);
  ok("invoice partner + ref", v && v.partner_id === 101 && v.ref === "BK-abc123", JSON.stringify({ p: v?.partner_id, r: v?.ref }));
  ok("invoice lines use [0,0,{...}] command form", v && Array.isArray(v.invoice_line_ids) && v.invoice_line_ids.length === 3 &&
     v.invoice_line_ids[0][0] === 0 && v.invoice_line_ids[0][2].quantity === 2 && v.invoice_line_ids[0][2].price_unit === 65, JSON.stringify(v?.invoice_line_ids?.[0]));
  ok("invoice posted (action_post called)", calls.some((c) => c.model === "account.move" && c.method === "action_post"), "");

  const att = await pushAttendance(env, uid, "101", "2026-06-25 14:30:00");
  ok("attendance check_in created", att.action === "check_in" && att.attendance_id === 9001, JSON.stringify(att));
  const ac = calls.find((c) => c.model === "hr.attendance" && c.method === "create");
  ok("attendance create has employee_id + check_in", ac && ac.args[0].employee_id === 1 && ac.args[0].check_in === "2026-06-25 14:30:00", JSON.stringify(ac?.args[0]));
} catch (e) { ok("no exceptions", false, e.message); }

server.close();
console.log(`\n==== Odoo call-construction: ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) process.exit(1);
