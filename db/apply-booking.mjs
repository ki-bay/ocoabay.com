// Apply Phase-1 booking schema + seed to Neon. Idempotent. Run: node db/apply-booking.mjs
// Reads DATABASE_URL from .dev.vars (or env). Never prints the connection string.
import { neon } from "@neondatabase/serverless";
import fs from "fs";

const m = fs.readFileSync(".dev.vars", "utf8").match(/^DATABASE_URL=(.+)$/m);
const url = (m ? m[1].trim().replace(/^["']|["']$/g, "") : process.env.DATABASE_URL);
const sql = neon(url);

// run a raw DDL/DML string over the HTTP driver (mimics a tagged-template call)
const run = (s) => { const t = [s]; t.raw = [s]; return sql(t); };

function statements(file) {
  const text = fs.readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))   // strip line + inline comments (no '--' inside our literals)
    .join("\n");
  return text.split(";").map((s) => s.trim()).filter(Boolean);
}

for (const file of ["db/booking-schema.sql", "db/booking-seed.sql"]) {
  const stmts = statements(file);
  let ok = 0;
  for (const st of stmts) { await run(st); ok++; }
  console.log(`${file}: ${ok} statements applied`);
}

const svc = await sql`select slug, type, base_price_cents, config->>'tax_bps' tax, config->>'service_charge_bps' svc from services order by id`;
console.log("services:");
for (const s of svc) console.log(`  ${s.slug.padEnd(16)} ${s.type.padEnd(11)} base=${s.base_price_cents} itbis_bps=${s.tax} propina_bps=${s.svc}`);
