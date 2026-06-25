/* OcoaBay booking widget — renders into <div id="ocoa-booking" data-service="..."> and drives
   /api/booking/*. Bilingual (EN/ES via ?lang or data-lang). Wires Stripe Payment Element when
   the confirm response carries a client_secret; otherwise shows the reservation-received state. */
(function () {
  "use strict";
  var root = document.getElementById("ocoa-booking");
  if (!root) return;
  var P = new URLSearchParams(location.search);
  var service = P.get("service") || root.getAttribute("data-service") || "";  // empty -> service picker
  var allowBack = !(P.get("service") || root.getAttribute("data-service"));    // came in via the picker
  var lang = (P.get("lang") || root.getAttribute("data-lang") || document.documentElement.lang || "en").slice(0, 2) === "es" ? "es" : "en";

  var T = {
    en: { pick_date: "Choose a date", pick_session: "Choose a time", guests: "Guests", details: "Your details",
      name: "Full name", email: "Email", phone: "Phone (optional)", reserve: "Reserve", pay: "Pay & confirm",
      subtotal: "Subtotal", itbis: "ITBIS (18%)", propina: "Legal Tip (10%)", total: "Total", loading: "Loading availability…",
      none_left: "Sold out", by_consumption: "Pay by consumption on-site (minimum à la carte purchase). Pool & Club House 11:00–18:30.",
      day: "Reserve this day", sending: "Processing…", thanks: "Thank you,", confirmed: "Your reservation is confirmed. A confirmation has been emailed to you.",
      arrange: "We've received your reservation and will contact you to arrange payment.",
      err_contact: "Please enter your name and a valid email.", err_net: "Network error. Please try again.",
      no_dates: "No dates currently available.", policy: "Reschedule allowed up to 72h before. No refunds.", per_person: "per person" },
    es: { pick_date: "Elige una fecha", pick_session: "Elige un horario", guests: "Huéspedes", details: "Tus datos",
      name: "Nombre completo", email: "Correo electrónico", phone: "Teléfono (opcional)", reserve: "Reservar", pay: "Pagar y confirmar",
      subtotal: "Subtotal", itbis: "ITBIS (18%)", propina: "Propina Legal (10%)", total: "Total", loading: "Cargando disponibilidad…",
      none_left: "Agotado", by_consumption: "Pago por consumo en el lugar (compra mínima à la carte). Piscina y Club House 11:00–18:30.",
      day: "Reservar este día", sending: "Procesando…", thanks: "¡Gracias,", confirmed: "Tu reserva está confirmada. Te enviamos un correo de confirmación.",
      arrange: "Hemos recibido tu reserva y te contactaremos para coordinar el pago.",
      err_contact: "Ingresa tu nombre y un correo válido.", err_net: "Error de red. Intenta de nuevo.",
      no_dates: "No hay fechas disponibles por ahora.", policy: "Reprogramación hasta 72 h antes. No hay reembolsos.", per_person: "por persona" },
  }[lang];

  var money = function (c) { return new Intl.NumberFormat(lang === "es" ? "es-DO" : "en-US", { style: "currency", currency: "USD" }).format((c || 0) / 100); };
  var dfmt = function (iso, opts) { return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", Object.assign({ timeZone: "America/Santo_Domingo" }, opts)).format(new Date(iso)); };

  // ---- service-specific detail fields (bilingual, dropdowns) ----
  var OPT = function (v, en, es) { return { v: v, en: en, es: es }; };
  var DIET = [OPT("", "No restrictions", "Sin restricciones"), OPT("Vegetarian", "Vegetarian", "Vegetariano"), OPT("Vegan", "Vegan", "Vegano"), OPT("Gluten-free", "Gluten-free", "Sin gluten"), OPT("Other", "Other (note below)", "Otro (indicar abajo)")];
  var OCCASION = [OPT("", "—", "—"), OPT("Birthday", "Birthday", "Cumpleaños"), OPT("Anniversary", "Anniversary", "Aniversario"), OPT("Honeymoon", "Honeymoon", "Luna de miel"), OPT("Corporate", "Corporate / group", "Corporativo / grupo"), OPT("Other", "Other", "Otro")];
  var TLANG = [OPT("English", "English", "Inglés"), OPT("Spanish", "Spanish", "Español")];
  var SEATING = [OPT("", "No preference", "Sin preferencia"), OPT("Indoor", "Indoor", "Interior"), OPT("Outdoor", "Outdoor / terrace", "Exterior / terraza"), OPT("Poolside", "Poolside", "Junto a la piscina")];
  var ARRIVAL = ["11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"].map(function (h) { return OPT(h, h, h); });
  var MAINS = [OPT("Meat", "Meat", "Carne"), OPT("Fish", "Fish", "Pescado"), OPT("Vegetarian", "Vegetarian", "Vegetariano")];
  var L = function (o) { return lang === "es" ? o.es : o.en; };
  var FL = { tour_language: { en: "Tour language", es: "Idioma del tour" }, dietary: { en: "Dietary needs", es: "Necesidades dietéticas" },
    occasion: { en: "Special occasion", es: "Ocasión especial" }, requests: { en: "Special requests / allergies", es: "Solicitudes especiales / alergias" },
    seating: { en: "Seating preference", es: "Preferencia de mesa" }, arrival_time: { en: "Preferred arrival time", es: "Hora de llegada preferida" },
    main: { en: "Main course — guest", es: "Plato fuerte — huésped" } };
  // per-service field list (menu handled specially for full-experience)
  var FIELDS = {
    "wine-tour": [["tour_language", TLANG], ["dietary", DIET], ["occasion", OCCASION]],
    "full-experience": [["tour_language", TLANG], ["dietary", DIET], ["occasion", OCCASION]],
    "club-house": [["arrival_time", ARRIVAL], ["seating", SEATING], ["dietary", DIET], ["occasion", OCCASION]],
  };

  function fieldsHTML() {
    var defs = FIELDS[service] || [];
    var h = '<div class="ob-step"><span class="ob-label">' + (lang === "es" ? "Detalles de la experiencia" : "Experience details") + '</span><div class="ob-row">';
    defs.forEach(function (d) {
      var name = d[0], opts = d[1];
      h += '<div class="ob-field"><label for="of-' + name + '">' + (lang === "es" ? FL[name].es : FL[name].en) + "</label>" +
        '<select id="of-' + name + '" class="ob-detail" data-name="' + name + '">' +
        opts.map(function (o) { return '<option value="' + o.v + '">' + L(o) + "</option>"; }).join("") + "</select></div>";
    });
    h += "</div>";
    // Full Experience: per-guest 3-course main selection
    if (service === "full-experience") {
      h += '<div class="ob-row">';
      for (var i = 1; i <= S.qty; i++) {
        h += '<div class="ob-field"><label for="of-main-' + i + '">' + (lang === "es" ? FL.main.es : FL.main.en) + " " + i + "</label>" +
          '<select id="of-main-' + i + '" class="ob-detail" data-name="main_guest_' + i + '">' +
          MAINS.map(function (o) { return '<option value="' + o.v + '">' + L(o) + "</option>"; }).join("") + "</select></div>";
      }
      h += "</div>";
    }
    h += '<div class="ob-field"><label for="of-requests">' + (lang === "es" ? FL.requests.es : FL.requests.en) + '</label><textarea id="of-requests" class="ob-detail" data-name="requests" rows="2" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-family:inherit"></textarea></div>';
    return h + "</div>";
  }
  function collectDetails() {
    var det = {};
    root.querySelectorAll(".ob-detail").forEach(function (el) { if (el.value) det[el.getAttribute("data-name")] = el.value; });
    return det;
  }

  var S = { svc: null, byDate: {}, dates: [], date: null, slot: null, qty: 2, stripe: null };

  // ---- service catalogue for the picker (shown when no service is preset) ----
  var CATALOG = [
    { slug: "wine-tour", en: "Wine Tour Experience", es: "Experiencia Tour de Vinos", price: 6500,
      den: "90-min guided tasting + electric-car vineyard & bodega tour.", des: "Cata guiada de 90 min + recorrido en carro eléctrico por viñedos y bodega." },
    { slug: "full-experience", en: "Full OcoaBay Experience", es: "Experiencia Completa OcoaBay", price: 14500,
      den: "Wine Tour + welcome toast + 3-course wood-oven menu + pool & Club House.", des: "Tour de Vinos + brindis + menú de 3 tiempos al horno de leña + piscina y Club House." },
    { slug: "club-house", en: "OcoaBay Club House", es: "OcoaBay Club House", price: 0,
      den: "À-la-carte farm-to-table dining + pool & Club House (pay on-site).", des: "Comida à la carte de la granja a la mesa + piscina y Club House (pago en el lugar)." },
  ];

  function loadService(svc) {
    service = svc;
    S = { svc: null, byDate: {}, dates: [], date: null, slot: null, qty: 2, stripe: null };
    root.innerHTML = '<div class="ob-card"><p class="ob-sub">' + T.loading + "</p></div>";
    fetch("/api/booking/availability?service=" + encodeURIComponent(svc))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { root.innerHTML = '<div class="ob-card"><p class="ob-msg">' + d.error + "</p></div>"; return; }
        S.svc = d.service;
        (d.slots || []).forEach(function (s) { if (s.remaining <= 0) return; var day = s.starts_at.slice(0, 10); (S.byDate[day] = S.byDate[day] || []).push(s); });
        S.dates = Object.keys(S.byDate).sort();
        S.month = S.dates.length ? S.dates[0].slice(0, 7) : null;
        render();
      })
      .catch(function () { root.innerHTML = '<div class="ob-card"><p class="ob-msg">' + T.err_net + "</p></div>"; });
  }

  function renderPicker() {
    var title = lang === "es" ? "Elige tu experiencia" : "Choose your experience";
    var taxNote = lang === "es" ? "+ 18% ITBIS + 10% propina legal" : "+ 18% ITBIS + 10% legal tip";
    var h = '<div class="ob-card"><h2 class="ob-h">' + title + "</h2><div class=\"ob-picker\">";
    CATALOG.forEach(function (c) {
      var price = c.price ? (money(c.price) + " " + T.per_person + " <small style=\"color:#8a7a6f\">" + taxNote + "</small>") : (lang === "es" ? "Por consumo" : "By consumption");
      h += '<button class="ob-pick" data-svc="' + c.slug + '"><strong>' + (lang === "es" ? c.es : c.en) + "</strong>" +
        '<span class="ob-pick-d">' + (lang === "es" ? c.des : c.den) + "</span>" +
        '<span class="ob-pick-p">' + price + "</span></button>";
    });
    h += "</div></div>";
    root.innerHTML = h;
    root.querySelectorAll("[data-svc]").forEach(function (el) { el.onclick = function () { loadService(el.getAttribute("data-svc")); }; });
  }

  if (service) loadService(service); else renderPicker();

  function priced() {
    var base = S.svc.base_price_cents || 0;
    if (!base) return null; // by-consumption (club house)
    var sub = base * S.qty, itbis = Math.round(sub * 0.18), prop = Math.round(sub * 0.10);
    return { sub: sub, itbis: itbis, prop: prop, total: sub + itbis + prop };
  }

  function calendarHTML() {
    if (!S.month || !S.dates.length) return "";
    var avail = {}; S.dates.forEach(function (d) { avail[d] = (S.byDate[d] || []).reduce(function (a, s) { return a + s.remaining; }, 0); });
    var minMonth = S.dates[0].slice(0, 7), maxMonth = S.dates[S.dates.length - 1].slice(0, 7);
    var y = parseInt(S.month.slice(0, 4), 10), m = parseInt(S.month.slice(5, 7), 10);
    var first = new Date(Date.UTC(y, m - 1, 1));
    var startDow = first.getUTCDay();
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var title = new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
    var dows = lang === "es" ? ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"] : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    var h = '<div class="ob-cal"><div class="ob-cal-head">' +
      '<button type="button" class="ob-cal-nav" data-mo="-1"' + (S.month <= minMonth ? " disabled" : "") + ' aria-label="previous month">&lsaquo;</button>' +
      '<span class="ob-cal-title">' + title.charAt(0).toUpperCase() + title.slice(1) + "</span>" +
      '<button type="button" class="ob-cal-nav" data-mo="1"' + (S.month >= maxMonth ? " disabled" : "") + ' aria-label="next month">&rsaquo;</button></div>';
    h += '<div class="ob-cal-grid">';
    dows.forEach(function (d) { h += '<span class="ob-cal-dow">' + d + "</span>"; });
    for (var i = 0; i < startDow; i++) h += "<span></span>";
    for (var day = 1; day <= dim; day++) {
      var ds = y + "-" + String(m).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      if (avail[ds]) h += '<button type="button" class="ob-cal-day avail' + (S.date === ds ? " sel" : "") + '" data-date="' + ds + '" title="' + avail[ds] + " " + T.guests.toLowerCase() + '">' + day + "</button>";
      else h += '<span class="ob-cal-day muted">' + day + "</span>";
    }
    return h + "</div></div>";
  }

  function render() {
    if (!S.dates.length) { root.innerHTML = '<div class="ob-card"><h2 class="ob-h">' + (lang === "es" ? S.svc.name_es : S.svc.name_en) + '</h2><p class="ob-msg">' + T.no_dates + "</p></div>"; return; }
    var isDay = S.svc.pricing_model === "quote"; // club house
    var h = '<div class="ob-card">';
    if (allowBack) h += '<button type="button" class="ob-back-link" id="ob-back">&larr; ' + (lang === "es" ? "Cambiar experiencia" : "Change experience") + "</button>";
    h += '<h2 class="ob-h">' + (lang === "es" ? S.svc.name_es : S.svc.name_en) + "</h2>";
    if (S.svc.base_price_cents) h += '<p class="ob-sub">' + money(S.svc.base_price_cents) + " " + T.per_person + "</p>";

    // dates — month-grid calendar
    h += '<div class="ob-step"><span class="ob-label">' + T.pick_date + "</span>" + calendarHTML() + "</div>";

    // sessions for selected date
    if (S.date) {
      h += '<div class="ob-step"><span class="ob-label">' + (isDay ? "" : T.pick_session) + '</span><div class="ob-sessions">';
      S.byDate[S.date].forEach(function (s) {
        var sel = S.slot && S.slot.slot_id === s.slot_id;
        var lbl = isDay ? T.day : dfmt(s.starts_at, { hour: "numeric", minute: "2-digit" });
        h += '<div class="ob-chip' + (sel ? " sel" : "") + '" data-slot="' + s.slot_id + '">' + lbl +
          "<small>" + s.remaining + " " + T.guests.toLowerCase() + "</small></div>";
      });
      h += "</div></div>";
    }

    // qty + details + summary once a slot is picked
    if (S.slot) {
      var max = S.slot.remaining;
      h += '<div class="ob-step"><span class="ob-label">' + T.guests + '</span>' +
        '<div class="ob-qty"><button data-q="-1">−</button><span id="ob-qty">' + S.qty + '</span><button data-q="1">+</button></div>' +
        ' <small class="ob-note" style="margin-left:8px">max ' + max + "</small></div>";

      var pr = priced();
      if (pr) {
        h += '<div class="ob-summary"><div class="r"><span>' + T.subtotal + "</span><span>" + money(pr.sub) + "</span></div>" +
          '<div class="r"><span>' + T.itbis + "</span><span>" + money(pr.itbis) + "</span></div>" +
          '<div class="r"><span>' + T.propina + "</span><span>" + money(pr.prop) + "</span></div>" +
          '<div class="r t"><span>' + T.total + "</span><span>" + money(pr.total) + "</span></div></div>";
      } else {
        h += '<p class="ob-note">' + T.by_consumption + "</p>";
      }

      h += fieldsHTML();

      h += '<div class="ob-step"><span class="ob-label">' + T.details + "</span>" +
        '<div class="ob-row"><div class="ob-field"><label>' + T.name + ' *</label><input id="ob-name"></div>' +
        '<div class="ob-field"><label>' + T.email + ' *</label><input id="ob-email" type="email"></div></div>' +
        '<div class="ob-field"><label>' + T.phone + '</label><input id="ob-phone"></div></div>';

      h += '<div id="ob-pay-element"></div><div class="ob-msg" id="ob-msg"></div>' +
        '<button class="ob-btn" id="ob-go">' + (pr ? T.reserve : T.reserve) + "</button>";
    }

    h += '<p class="ob-policy">' + T.policy + "</p></div>";
    root.innerHTML = h;
    bind();
  }

  function bind() {
    root.querySelectorAll("[data-date]").forEach(function (el) {
      el.onclick = function () { S.date = el.getAttribute("data-date"); S.slot = null; render(); };
    });
    root.querySelectorAll(".ob-cal-nav").forEach(function (el) {
      el.onclick = function () {
        if (el.disabled) return;
        var y = parseInt(S.month.slice(0, 4), 10), m = parseInt(S.month.slice(5, 7), 10) + parseInt(el.getAttribute("data-mo"), 10);
        if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
        S.month = y + "-" + String(m).padStart(2, "0"); render();
      };
    });
    root.querySelectorAll("[data-slot]").forEach(function (el) {
      el.onclick = function () {
        var id = el.getAttribute("data-slot");
        S.slot = S.byDate[S.date].filter(function (s) { return s.slot_id === id; })[0];
        S.qty = Math.min(S.qty, S.slot.remaining) || 1; render();
      };
    });
    root.querySelectorAll("[data-q]").forEach(function (el) {
      el.onclick = function () {
        var n = S.qty + parseInt(el.getAttribute("data-q"), 10);
        S.qty = Math.max(1, Math.min(S.slot.remaining, n)); render();
      };
    });
    var go = document.getElementById("ob-go");
    if (go) go.onclick = submit;
    var back = document.getElementById("ob-back");
    if (back) back.onclick = function () { renderPicker(); };
  }

  function loadStripe() {
    return new Promise(function (res, rej) { if (window.Stripe) return res(); var s = document.createElement("script"); s.src = "https://js.stripe.com/v3/"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }

  function submit() {
    var msg = document.getElementById("ob-msg"), btn = document.getElementById("ob-go");
    var name = (document.getElementById("ob-name").value || "").trim();
    var email = (document.getElementById("ob-email").value || "").trim();
    var phone = (document.getElementById("ob-phone").value || "").trim();
    msg.textContent = "";

    // Stripe step 2: card armed -> confirm payment
    if (S.stripe) {
      btn.disabled = true; btn.textContent = T.sending;
      S.stripe.stripe.confirmPayment({ elements: S.stripe.elements, confirmParams: { return_url: location.href.split("#")[0] } })
        .then(function (r) { if (r && r.error) { msg.textContent = r.error.message || T.err_net; btn.disabled = false; btn.textContent = T.pay; } });
      return;
    }

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = T.err_contact; return; }
    var details = collectDetails();
    btn.disabled = true; btn.textContent = T.sending;

    fetch("/api/booking/hold", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot_id: S.slot.slot_id, qty: S.qty }) })
      .then(function (r) { return r.json(); })
      .then(function (h) {
        if (!h.ok) throw new Error(h.error || T.err_net);
        return fetch("/api/booking/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hold_id: h.hold_id, name: name, email: email, phone: phone, language: lang, details: details }) }).then(function (r) { return r.json(); });
      })
      .then(function (c) {
        if (!c.ok) throw new Error(c.error || T.err_net);
        if (c.payment === "stripe" && c.client_secret) { armStripe(c, name); return; }
        success(name, c.payment);
      })
      .catch(function (e) { msg.textContent = e.message || T.err_net; if (btn) { btn.disabled = false; btn.textContent = T.reserve; } });
  }

  function armStripe(c, name) {
    loadStripe().then(function () {
      var stripe = window.Stripe(c.publishable_key);
      var elements = stripe.elements({ clientSecret: c.client_secret });
      elements.create("payment").mount("#ob-pay-element");
      S.stripe = { stripe: stripe, elements: elements };
      var btn = document.getElementById("ob-go"); btn.disabled = false; btn.textContent = T.pay;
    }).catch(function () { success(name, "arrange"); });
  }

  function success(name, mode) {
    root.innerHTML = '<div class="ob-card ob-ok"><h3>' + T.thanks + " " + name + "!</h3><p>" +
      (mode === "arrange" ? T.arrange : T.confirmed) + "</p></div>";
  }
})();
