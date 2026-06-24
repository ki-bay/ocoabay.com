/* OcoaBay archive renderer — category & tag listing pages.
   Reads the slug from the path (/product-category/<slug>/ or /product-tag/<slug>/)
   and renders the product grid from /api/products. */
(function () {
  "use strict";
  var root = document.getElementById("ocoa-archive-root");
  if (!root) return;
  var money = function (c, cur) { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format((c || 0) / 100); };

  var parts = location.pathname.replace(/\/+$/, "").split("/");
  var slug = decodeURIComponent(parts[parts.length - 1] || "");
  var isTag = location.pathname.indexOf("/product-tag/") === 0;
  var qs = (isTag ? "tag=" : "category=") + encodeURIComponent(slug);

  var heading = document.getElementById("ocoa-archive-title");
  if (heading) heading.textContent = slug.replace(/-/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); });

  root.innerHTML = '<p class="ocoa-cart-loading">Loading products…</p>';
  fetch("/api/products?" + qs, { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
    var items = j.products || [];
    if (!items.length) { root.innerHTML = '<p style="text-align:center;padding:40px">No products found in “' + slug + '”.</p>'; return; }
    root.innerHTML = '<div class="ocoa-grid">' + items.map(function (p) {
      var img = Array.isArray(p.images) && p.images[0] ? (p.images[0].src || p.images[0].thumbnail) : "";
      var oos = p.stock_status === "outofstock";
      return '<div class="ocoa-card"><a href="/product/' + p.slug + '/">' + (img ? '<img src="' + img + '" alt="' + p.name + '">' : "") +
        "<h3>" + p.name + "</h3></a><div class=\"price\">" + money(p.price_cents, p.currency) + "</div>" +
        (oos ? '<span class="ocoa-tag">Out of stock</span>' :
          '<a class="ocoa-btn add_to_cart_button" data-product_id="' + p.woo_id + '" href="?add-to-cart=' + p.woo_id + '">Add to cart</a>') + "</div>";
    }).join("") + "</div>";
  });
})();
