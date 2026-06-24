// Cutover guard: while served from *.pages.dev (preview/staging), tell search
// engines not to index — prevents duplicate-content with the live ocoabay.com.
// Once the custom domain (ocoabay.com) is attached, indexing is automatically allowed.
export async function onRequest(context) {
  const res = await context.next();
  const host = new URL(context.request.url).hostname;
  if (host.endsWith(".pages.dev")) {
    const h = new Headers(res.headers);
    h.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
  return res;
}
