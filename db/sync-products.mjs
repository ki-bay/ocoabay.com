// Sync the WooCommerce catalog (products + categories) into Neon.
// Uses the PUBLIC WooCommerce Store API (no key needed for catalog).
// Run: node db/sync-products.mjs   (reads DATABASE_URL from .env.local)
//
// Idempotent: re-run any time to refresh. Keyed on Woo product/category id.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const m = readFileSync(".env.local", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m);
if (!m) { console.error("DATABASE_URL not found in .env.local"); process.exit(1); }
const sql = neon(m[1]);
const base = "https://ocoabay.com/wp-json/wc/store/v1";
const cents = (v) => (v === null || v === undefined || v === "" ? null : parseInt(v, 10));

const cats = await (await fetch(`${base}/products/categories?per_page=100`)).json();
for (const c of cats) {
  await sql`insert into categories (woo_id,name,slug,parent_woo_id,description,count,raw)
    values (${c.id},${c.name},${c.slug},${c.parent || null},${c.description || null},${c.count || 0},${JSON.stringify(c)})
    on conflict (woo_id) do update set name=excluded.name, slug=excluded.slug, count=excluded.count, raw=excluded.raw`;
}

const prods = await (await fetch(`${base}/products?per_page=100`)).json();
for (const p of prods) {
  await sql`insert into products
    (woo_id,name,slug,type,sku,permalink,price_cents,regular_price_cents,sale_price_cents,on_sale,currency,stock_status,description,short_description,images,categories,attributes,variations,raw)
    values (${p.id},${p.name},${p.slug},${p.type},${p.sku || null},${p.permalink || null},
      ${cents(p.prices?.price)},${cents(p.prices?.regular_price)},${cents(p.prices?.sale_price)},${!!p.on_sale},
      ${p.prices?.currency_code || "USD"},${p.is_in_stock ? "instock" : "outofstock"},
      ${p.description || null},${p.short_description || null},
      ${JSON.stringify(p.images || [])},${JSON.stringify(p.categories || [])},${JSON.stringify(p.attributes || [])},${JSON.stringify(p.variations || [])},${JSON.stringify(p)})
    on conflict (woo_id) do update set name=excluded.name, price_cents=excluded.price_cents,
      stock_status=excluded.stock_status, raw=excluded.raw, updated_at=now()`;
}
console.log(`Synced ${prods.length} products, ${cats.length} categories into Neon.`);
