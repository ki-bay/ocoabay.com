/* OcoaBay storefront — cart, side-drawer, coupon, totals, checkout, order, account links.
   Backend: /api/cart, /api/checkout, /api/order, /api/auth. Money in cents. */
(function () {
  "use strict";
  var money = function (c, cur) { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format((c || 0) / 100); };
  function api(url, body) {
    return fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) }
      : { credentials: "same-origin" }).then(function (r) { return r.json(); });
  }
  function setBadge(n) {
    document.querySelectorAll(".xoo-wsc-items-count,[data-ocoa-count]").forEach(function (el) { el.textContent = n; });
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "ocoa-toast"; t.textContent = msg;
    document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 2000);
  }

  // ---------- side drawer ----------
  var drawer;
  function ensureDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement("div");
    drawer.id = "ocoa-drawer";
    drawer.innerHTML = '<div class="ocoa-drawer-bg"></div><aside class="ocoa-drawer-panel">' +
      '<header><span>Your Cart</span><button class="ocoa-drawer-x" aria-label="Close">×</button></header>' +
      '<div class="ocoa-drawer-body"></div></aside>';
    document.body.appendChild(drawer);
    drawer.querySelector(".ocoa-drawer-bg").addEventListener("click", closeDrawer);
    drawer.querySelector(".ocoa-drawer-x").addEventListener("click", closeDrawer);
    return drawer;
  }
  function openDrawer() { ensureDrawer(); drawer.classList.add("open"); renderDrawer(); }
  function closeDrawer() { if (drawer) drawer.classList.remove("open"); }
  function renderDrawer() {
    var body = drawer.querySelector(".ocoa-drawer-body");
    body.innerHTML = '<p class="ocoa-cart-loading">Loading…</p>';
    api("/api/cart").then(function (c) {
      if (!c.lines || !c.lines.length) { body.innerHTML = '<p style="padding:24px;text-align:center">Your cart is empty.</p>'; return; }
      body.innerHTML = c.lines.map(function (l) {
        return '<div class="ocoa-dl" data-pid="' + l.product_id + '">' + (l.image ? '<img src="' + l.image + '">' : "") +
          '<div class="ocoa-dl-info"><strong>' + l.name + "</strong><span>" + l.qty + " × " + money(l.price_cents, c.currency) + "</span></div>" +
          '<button class="ocoa-rm" data-act="rm">×</button></div>';
      }).join("") +
        '<div class="ocoa-dl-foot"><div class="ocoa-totals"><span>Subtotal</span><strong>' + money(c.subtotal_cents, c.currency) + "</strong></div>" +
        '<a class="ocoa-btn" href="/cart/">View cart</a><a class="ocoa-btn ocoa-btn-primary" href="/checkout/">Checkout</a></div>';
      body.querySelectorAll("button[data-act=rm]").forEach(function (b) {
        b.addEventListener("click", function () {
          api("/api/cart", { action: "remove", product_id: parseInt(b.closest(".ocoa-dl").dataset.pid, 10) })
            .then(function (c) { setBadge(c.count); renderDrawer(); });
        });
      });
    });
  }

  // ---------- add to cart ----------
  function productIdFrom(el) {
    if (el.dataset && el.dataset.product_id) return parseInt(el.dataset.product_id, 10);
    var m = (el.getAttribute("href") || "").match(/[?&]add-to-cart=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  document.addEventListener("click", function (e) {
    var add = e.target.closest("a.add_to_cart_button, a.ajax_add_to_cart, a[href*='add-to-cart='], [data-ocoa-add]");
    if (add) {
      var pid = productIdFrom(add); if (!pid) return;
      e.preventDefault();
      var qty = parseInt(add.getAttribute("data-quantity"), 10) || 1;
      add.classList.add("loading");
      api("/api/cart", { action: "add", product_id: pid, qty: qty }).then(function (c) {
        add.classList.remove("loading"); add.classList.add("added"); setBadge(c.count); openDrawer();
      }).catch(function () { add.classList.remove("loading"); toast("Could not add to cart"); });
      return;
    }
    var basket = e.target.closest(".xoo-wsc-basket, [data-ocoa-cart-link]");
    if (basket) { e.preventDefault(); openDrawer(); }
  });

  // ---------- totals block ----------
  function totalsHTML(c) {
    var rows = '<div class="row"><span>Subtotal</span><span>' + money(c.subtotal_cents, c.currency) + "</span></div>";
    if (c.discount_cents) rows += '<div class="row"><span>Discount' + (c.coupon ? " (" + c.coupon.code + ")" : "") + "</span><span>−" + money(c.discount_cents, c.currency) + "</span></div>";
    rows += '<div class="row"><span>Shipping</span><span>' + (c.shipping_cents ? money(c.shipping_cents, c.currency) : "Free") + "</span></div>";
    rows += '<div class="row"><span>Tax (ITBIS)</span><span>' + money(c.tax_cents, c.currency) + "</span></div>";
    rows += '<div class="row" style="font-size:18px;border:0"><span>Total</span><strong>' + money(c.total_cents, c.currency) + "</strong></div>";
    return rows;
  }

  // ---------- /cart/ ----------
  function renderCart() {
    var root = document.getElementById("ocoa-cart-root"); if (!root) return;
    var summaryOnly = root.dataset.summary === "1";
    root.innerHTML = '<p class="ocoa-cart-loading">Loading…</p>';
    api("/api/cart").then(function (c) {
      if (!c.lines || !c.lines.length) {
        root.innerHTML = '<div class="ocoa-cart-empty"><p>Your cart is currently empty.</p><a class="ocoa-btn" href="/products/">Return to shop</a></div>';
        return;
      }
      if (summaryOnly) { root.innerHTML = '<div class="ocoa-totals-block">' + totalsHTML(c) + "</div>"; return; }
      var rows = c.lines.map(function (l) {
        var stock = l.stock_status === "outofstock" ? '<em style="color:#b00">Out of stock</em>' : (l.low_stock ? '<em style="color:#c87">Only ' + l.low_stock + " left</em>" : "");
        return '<tr data-pid="' + l.product_id + '"><td class="ocoa-ci">' + (l.image ? '<img src="' + l.image + '">' : "") +
          "<span>" + l.name + " " + stock + "</span></td><td>" + money(l.price_cents, c.currency) +
          '</td><td><div class="ocoa-qty"><button data-act="dec">−</button><span>' + l.qty + '</span><button data-act="inc">+</button></div></td><td>' +
          money(l.line_total_cents, c.currency) + '</td><td><button class="ocoa-rm" data-act="rm">×</button></td></tr>';
      }).join("");
      root.innerHTML =
        '<table class="ocoa-cart-table"><thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" +
        '<div class="ocoa-cart-grid"><div class="ocoa-coupon"><input id="ocoa-coupon" placeholder="Coupon code" value="' + (c.coupon ? c.coupon.code : "") + '"><button class="ocoa-btn" id="ocoa-coupon-btn">Apply</button>' +
        '<div class="ocoa-coupon-msg">' + (c.coupon_error || "") + "</div></div>" +
        '<div class="ocoa-totals-block">' + totalsHTML(c) + '<a class="ocoa-btn ocoa-btn-primary" href="/checkout/" style="margin-top:14px;display:block;text-align:center">Proceed to checkout</a></div></div>';
      root.querySelectorAll("button[data-act]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var tr = btn.closest("tr"), pid = parseInt(tr.dataset.pid, 10), act = btn.dataset.act, cur = parseInt(tr.querySelector(".ocoa-qty span").textContent, 10);
          var body = act === "rm" ? { action: "remove", product_id: pid } : { action: "update", product_id: pid, qty: act === "inc" ? cur + 1 : cur - 1 };
          api("/api/cart", body).then(function (c) { setBadge(c.count); renderCart(); });
        });
      });
      var cbtn = root.querySelector("#ocoa-coupon-btn");
      if (cbtn) cbtn.addEventListener("click", function () {
        api("/api/cart", { action: "coupon", code: root.querySelector("#ocoa-coupon").value.trim() }).then(function (c) { setBadge(c.count); renderCart(); if (!c.coupon_error && c.coupon) toast("Coupon applied"); });
      });
    });
  }

  // ---------- /checkout/ ----------
  function bindCheckout() {
    var form = document.getElementById("ocoa-checkout-form"); if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("ocoa-pay-msg"), btn = document.getElementById("ocoa-pay-btn");
      var data = {}; form.querySelectorAll("input, textarea").forEach(function (i) { if (i.name) data[i.name] = i.value; });
      if (msg) msg.textContent = "";
      var email = data.email || "";
      if (!data.name) { if (msg) msg.textContent = "Please enter your name."; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (msg) msg.textContent = "Please enter a valid email."; return; }
      if (btn) { btn.disabled = true; btn.textContent = "Placing order…"; }
      api("/api/checkout", data).then(function (r) {
        if (r.ok && r.order_id) location.href = "/order-confirmation/?order=" + encodeURIComponent(r.order_id);
        else { if (msg) msg.textContent = r.error || "Could not place order."; if (btn) { btn.disabled = false; btn.textContent = "Place order"; } }
      }).catch(function () { if (msg) msg.textContent = "Network error."; if (btn) { btn.disabled = false; btn.textContent = "Place order"; } });
    });
  }

  // ---------- /order-confirmation/ ----------
  function renderOrder() {
    var root = document.getElementById("ocoa-order-root"); if (!root) return;
    var id = new URLSearchParams(location.search).get("order");
    if (!id) { root.innerHTML = "<p>No order specified.</p>"; return; }
    api("/api/order?id=" + encodeURIComponent(id)).then(function (o) {
      if (o.error) { root.innerHTML = "<p>Order not found.</p>"; return; }
      var rows = (o.items || []).map(function (l) { return '<div class="row"><span>' + l.name + " × " + l.qty + "</span><strong>" + money(l.line_total_cents, o.currency) + "</strong></div>"; }).join("");
      root.innerHTML = '<div class="ocoa-order-ok"><h2>Thank you, ' + (o.name || "") + "!</h2><p>Order <code>" + String(o.id).slice(0, 8) +
        "</code> received. A confirmation was sent to <strong>" + o.email + "</strong>.</p></div>" +
        '<div class="ocoa-summary" style="max-width:520px;margin:24px auto">' + rows +
        '<div class="row" style="border:0;font-size:18px"><span>Total</span><strong>' + money(o.total_cents, o.currency) + "</strong></div>" +
        '<a class="ocoa-btn" href="/products/" style="margin-top:16px">Continue shopping</a></div>';
      setBadge(0);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    api("/api/cart").then(function (c) { setBadge(c.count || 0); }).catch(function () {});
    renderCart(); bindCheckout(); renderOrder();
  });
  window.OcoaCart = { open: openDrawer };
})();
