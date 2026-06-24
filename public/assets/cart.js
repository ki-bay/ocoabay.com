/* OcoaBay cart — drives the mirrored WooCommerce UI against /api/cart (Neon).
   - Updates the .xoo-wsc-items-count badge
   - Intercepts add-to-cart buttons / ?add-to-cart= links
   - Renders the /cart/ page into #ocoa-cart-root
*/
(function () {
  "use strict";
  var API = "/api/cart";
  var money = function (cents, cur) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format((cents || 0) / 100);
  };

  function post(body) {
    return fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }
  function get() {
    return fetch(API, { credentials: "same-origin" }).then(function (r) { return r.json(); });
  }

  function setBadge(count) {
    document.querySelectorAll(".xoo-wsc-items-count").forEach(function (el) { el.textContent = count; });
    document.querySelectorAll("[data-ocoa-count]").forEach(function (el) { el.textContent = count; });
    if (count > 0) document.body.classList.add("ocoa-has-items");
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "ocoa-toast"; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 2200);
  }

  function productIdFrom(el) {
    if (el.dataset && el.dataset.product_id) return parseInt(el.dataset.product_id, 10);
    var href = el.getAttribute && el.getAttribute("href");
    var m = href && href.match(/[?&]add-to-cart=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  document.addEventListener("click", function (e) {
    var a = e.target.closest(
      "a.add_to_cart_button, a.ajax_add_to_cart, a[href*='add-to-cart='], [data-ocoa-add]"
    );
    if (!a) {
      var basket = e.target.closest(".xoo-wsc-basket, [data-ocoa-cart-link]");
      if (basket) { e.preventDefault(); location.href = "/cart/"; }
      return;
    }
    var pid = productIdFrom(a);
    if (!pid) return;
    e.preventDefault();
    var qty = parseInt(a.getAttribute("data-quantity"), 10) || 1;
    a.classList.add("loading");
    post({ action: "add", product_id: pid, qty: qty }).then(function (c) {
      a.classList.remove("loading"); a.classList.add("added");
      setBadge(c.count);
      toast((a.getAttribute("aria-label") || "Added to cart").replace(/^Add to cart:\s*/i, "Added: ") );
    }).catch(function () { a.classList.remove("loading"); toast("Could not add to cart"); });
  });

  // ----- /cart/ page rendering -----
  function renderCart() {
    var root = document.getElementById("ocoa-cart-root");
    if (!root) return;
    root.innerHTML = '<p class="ocoa-cart-loading">Loading your cart…</p>';
    get().then(function (c) {
      if (!c.lines || !c.lines.length) {
        root.innerHTML = '<div class="ocoa-cart-empty"><p>Your cart is currently empty.</p>' +
          '<a class="ocoa-btn" href="/products/">Return to shop</a></div>';
        return;
      }
      var rows = c.lines.map(function (l) {
        return '<tr data-pid="' + l.product_id + '">' +
          '<td class="ocoa-ci">' + (l.image ? '<img src="' + l.image + '" alt="">' : "") +
            '<span>' + l.name + "</span></td>" +
          "<td>" + money(l.price_cents, c.currency) + "</td>" +
          '<td><div class="ocoa-qty"><button data-act="dec">−</button><span>' + l.qty +
            '</span><button data-act="inc">+</button></div></td>' +
          "<td>" + money(l.line_total_cents, c.currency) + "</td>" +
          '<td><button class="ocoa-rm" data-act="rm" aria-label="Remove">×</button></td></tr>';
      }).join("");
      root.innerHTML =
        '<table class="ocoa-cart-table"><thead><tr><th>Product</th><th>Price</th><th>Quantity</th><th>Subtotal</th><th></th></tr></thead><tbody>' +
        rows + "</tbody></table>" +
        '<div class="ocoa-cart-foot"><div class="ocoa-totals"><span>Subtotal</span><strong>' +
        money(c.subtotal_cents, c.currency) + "</strong></div>" +
        '<a class="ocoa-btn ocoa-btn-primary" href="/checkout/">Proceed to checkout</a></div>';

      root.querySelectorAll("button[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var tr = btn.closest("tr"); var pid = parseInt(tr.dataset.pid, 10);
          var act = btn.dataset.act;
          var cur = parseInt(tr.querySelector(".ocoa-qty span").textContent, 10);
          var body = act === "rm" ? { action: "remove", product_id: pid }
            : { action: "update", product_id: pid, qty: act === "inc" ? cur + 1 : cur - 1 };
          post(body).then(function (c) { setBadge(c.count); renderCart(); });
        });
      });
    });
  }

  // ----- /checkout/ submit -> create order -----
  function bindCheckout() {
    var form = document.getElementById("ocoa-checkout-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("ocoa-pay-msg");
      var btn = document.getElementById("ocoa-pay-btn");
      var data = {};
      form.querySelectorAll("input").forEach(function (i) { if (i.name) data[i.name] = i.value; });
      if (msg) msg.textContent = "";
      if (btn) { btn.disabled = true; btn.textContent = "Placing order…"; }
      post2("/api/checkout", data).then(function (r) {
        if (r.ok && r.order_id) {
          location.href = "/order-confirmation/?order=" + encodeURIComponent(r.order_id);
        } else {
          if (msg) msg.textContent = r.error || "Could not place order.";
          if (btn) { btn.disabled = false; btn.textContent = "Place order"; }
        }
      }).catch(function () {
        if (msg) msg.textContent = "Network error. Please try again.";
        if (btn) { btn.disabled = false; btn.textContent = "Place order"; }
      });
    });
  }
  function post2(url, body) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  // ----- /order-confirmation/ -----
  function renderOrder() {
    var root = document.getElementById("ocoa-order-root");
    if (!root) return;
    var id = new URLSearchParams(location.search).get("order");
    if (!id) { root.innerHTML = "<p>No order specified.</p>"; return; }
    fetch("/api/order?id=" + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (o) {
      if (o.error) { root.innerHTML = "<p>Order not found.</p>"; return; }
      var rows = (o.items || []).map(function (l) {
        return "<div class='row'><span>" + l.name + " × " + l.qty + "</span><strong>" + money(l.line_total_cents, o.currency) + "</strong></div>";
      }).join("");
      root.innerHTML =
        "<div class='ocoa-order-ok'><h2>Thank you, " + (o.name || "") + "!</h2>" +
        "<p>Your order <code>" + o.id.slice(0, 8) + "</code> has been received. We'll email <strong>" + o.email + "</strong> with payment details.</p></div>" +
        "<div class='ocoa-summary' style='max-width:520px;margin:24px auto'>" + rows +
        "<div class='row' style='border:0;font-size:18px'><span>Total</span><strong>" + money(o.total_cents, o.currency) + "</strong></div>" +
        "<a class='ocoa-btn' href='/products/' style='margin-top:16px'>Continue shopping</a></div>";
      setBadge(0);
    });
  }

  // init
  document.addEventListener("DOMContentLoaded", function () {
    get().then(function (c) { setBadge(c.count || 0); }).catch(function () {});
    renderCart();
    bindCheckout();
    renderOrder();
  });
})();
