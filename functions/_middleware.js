// Pages middleware:
//  (1) Cutover guard — noindex while served from *.pages.dev (auto-lifts on the custom domain).
//  (2) Injects the chat widget (CSS+JS) into HTML pages, except /admin. Asset-only, no mirror edits.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  let res = await context.next();

  // (1) noindex on preview/staging hosts
  if (url.hostname.endsWith(".pages.dev")) {
    const h = new Headers(res.headers);
    h.set("X-Robots-Tag", "noindex, nofollow");
    res = new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }

  // (2) inject chat widget into HTML responses (skip the admin console)
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html") && !url.pathname.startsWith("/admin")) {
    res = new HTMLRewriter()
      .on("head", { element(e) { e.append('<link rel="stylesheet" href="/assets/chat.css">', { html: true }); } })
      .on("body", { element(e) { e.append('<script src="/assets/chat.js" defer></script>', { html: true }); } })
      .transform(res);
  }
  return res;
}
