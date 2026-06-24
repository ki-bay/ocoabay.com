// GET /api/products            -> list all products
// GET /api/products?slug=xxx   -> single product by slug
import { neon } from "@neondatabase/serverless";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const category = url.searchParams.get("category");
  const tag = url.searchParams.get("tag");
  const related = url.searchParams.get("related");
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
    // Related: products sharing any category with the given slug (excluding it)
    if (related) {
      const base = await sql`select categories from products where slug = ${related} limit 1`;
      const cats = (base[0]?.categories || []).map((c) => c.slug);
      if (!cats.length) return json({ products: [], count: 0 });
      const all = await sql`select woo_id, name, slug, price_cents, currency, stock_status, images, categories
        from products where slug <> ${related} order by name`;
      const rel = all.filter((p) => (p.categories || []).some((c) => cats.includes(c.slug))).slice(0, 4);
      return json({ products: rel, count: rel.length });
    }
    let rows;
    if (tag) {
      rows = await sql`select woo_id, name, slug, type, sku, permalink, price_cents,
        regular_price_cents, sale_price_cents, on_sale, currency, stock_status,
        short_description, images, categories
        from products where tags @> ${JSON.stringify([{ slug: tag }])} order by name`;
    } else if (category) {
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
