export async function onRequest(context) {
  const res = await context.env.ASSETS.fetch(new URL("/product-category/", context.request.url));
  return new Response(res.body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
