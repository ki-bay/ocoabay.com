// GET /api/products            -> list all products
// GET /api/products?slug=xxx   -> single product by slug
import { neon } from "@neondatabase/serverless";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const category = url.searchParams.get("category");
  const json = (d, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });

  try {
    const sql = neon(env.DATABASE_URL);

    if (slug) {
      const rows = await sql`select woo_id, name, slug, type, sku, permalink, price_cents,
        regular_price_cents, sale_price_cents, on_sale, currency, stock_status, description,
        short_description, images, categories, attributes
        from products where slug = ${slug} limit 1`;
      if (!rows.length) return json({ error: "Not found" }, 404);
      return json(rows[0]);
    }
    let rows;
    if (category) {
      rows = await sql`select woo_id, name, slug, type, sku, permalink, price_cents,
        regular_price_cents, sale_price_cents, on_sale, currency, stock_status,
        short_description, images, categories
        from products where categories @> ${JSON.stringify([{ slug: category }])} order by name`;
    } else {
      rows = await sql`select woo_id, name, slug, type, sku, permalink, price_cents,
        regular_price_cents, sale_price_cents, on_sale, currency, stock_status,
        short_description, images, categories
        from products order by name`;
    }
    return json({ products: rows, count: rows.length });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
