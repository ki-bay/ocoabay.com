/* OcoaBay My Account — login/register + dashboard (orders, addresses, profile). */
(function () {
  "use strict";
  var money = function (c, cur) { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format((c || 0) / 100); };
  function api(url, body) {
    return fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) } : { credentials: "same-origin" }).then(function (r) { return r.json(); });
  }
  var root = document.getElementById("ocoa-account-root");
  if (!root) return;

  function authView() {
    root.innerHTML =
      '<div class="ocoa-auth-card"><h2>Login</h2><form id="ocoa-login">' +
      '<label>Email</label><input name="email" type="email" required>' +
      '<label>Password</label><input name="password" type="password" required>' +
      '<div class="ocoa-pay-msg" id="login-msg"></div>' +
      '<button class="ocoa-btn ocoa-btn-primary" style="margin-top:12px">Log in</button></form>' +
      '<hr style="margin:24px 0;border:0;border-top:1px solid #eee"><h2>Create account</h2><form id="ocoa-register">' +
      '<label>Name</label><input name="name">' +
      '<label>Email</label><input name="email" type="email" required>' +
      '<label>Password</label><input name="password" type="password" minlength="6" required>' +
      '<div class="ocoa-pay-msg" id="reg-msg"></div>' +
      '<button class="ocoa-btn" style="margin-top:12px">Register</button></form></div>';
    bind("ocoa-login", "login", "login-msg");
    bind("ocoa-register", "signup", "reg-msg");
  }
  function bind(id, action, msgId) {
    var f = document.getElementById(id);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = { action: action }; f.querySelectorAll("input").forEach(function (i) { d[i.name] = i.value; });
      api("/api/auth", d).then(function (r) { if (r.ok) dashboard(); else document.getElementById(msgId).textContent = r.error || "Error"; });
    });
  }

  function dashboard() {
    api("/api/account").then(function (a) {
      if (a.error) { authView(); return; }
      root.innerHTML =
        '<div class="ocoa-account"><div class="tabs">' +
        '<button data-t="orders" class="active">Orders</button><button data-t="addresses">Addresses</button>' +
        '<button data-t="details">Account details</button><button data-t="logout">Logout</button></div>' +
        '<div id="acc-panel"></div></div>';
      var panel = document.getElementById("acc-panel");
      var tabs = root.querySelectorAll(".tabs button");
      tabs.forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.dataset.t === "logout") { api("/api/auth", { action: "logout" }).then(authView); return; }
          tabs.forEach(function (x) { x.classList.remove("active"); }); b.classList.add("active");
          render(b.dataset.t);
        });
      });
      function render(t) {
        if (t === "orders") {
          panel.innerHTML = a.orders.length ? '<table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>' +
            a.orders.map(function (o) {
              return "<tr><td><code>" + String(o.id).slice(0, 8) + "</code></td><td>" + new Date(o.created_at).toLocaleDateString() +
                '</td><td><span class="ocoa-tag">' + o.status.replace("_", " ") + "</span></td><td>" + money(o.total_cents, o.currency) +
                ' <a href="/api/invoice?id=' + o.id + '" style="margin-left:8px">Invoice</a></td></tr>';
            }).join("") + "</tbody></table>" : "<p>No orders yet.</p>";
        } else if (t === "addresses") {
          panel.innerHTML = (a.addresses.map(function (ad) {
            return '<div style="padding:12px 0;border-bottom:1px solid #eee">' + (ad.name || "") + ", " + (ad.line1 || "") + ", " + (ad.city || "") + " " + (ad.country || "") +
              (ad.is_default ? ' <span class="ocoa-tag">default</span>' : "") + "</div>";
          }).join("") || "<p>No saved addresses.</p>") +
            '<form id="addr" style="margin-top:16px;max-width:480px"><h3>Add address</h3>' +
            '<label>Name</label><input name="name"><label>Address</label><input name="line1"><label>City</label><input name="city"><label>Country</label><input name="country" value="Dominican Republic">' +
            '<label><input type="checkbox" name="is_default" style="width:auto"> Set as default</label>' +
            '<button class="ocoa-btn" style="margin-top:12px">Save address</button></form>';
          document.getElementById("addr").addEventListener("submit", function (e) {
            e.preventDefault(); var d = { action: "address" };
            this.querySelectorAll("input").forEach(function (i) { d[i.name] = i.type === "checkbox" ? i.checked : i.value; });
            api("/api/account", d).then(function () { api("/api/account").then(function (n) { a.addresses = n.addresses; render("addresses"); }); });
          });
        } else if (t === "details") {
          panel.innerHTML = '<form id="prof" style="max-width:480px"><label>Name</label><input name="name" value="' + (a.customer.name || "") +
            '"><label>Email</label><input value="' + a.customer.email + '" disabled><div class="ocoa-pay-msg" id="prof-msg"></div>' +
            '<button class="ocoa-btn ocoa-btn-primary" style="margin-top:12px">Save</button></form>';
          document.getElementById("prof").addEventListener("submit", function (e) {
            e.preventDefault();
            api("/api/account", { action: "profile", name: this.querySelector("[name=name]").value }).then(function () { document.getElementById("prof-msg").style.color = "#2a7"; document.getElementById("prof-msg").textContent = "Saved"; });
          });
        }
      }
      render("orders");
    });
  }

  api("/api/auth").then(function (r) { if (r.customer) dashboard(); else authView(); });
})();
