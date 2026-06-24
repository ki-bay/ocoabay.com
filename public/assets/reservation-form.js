/* OcoaBay reservation/booking form — renders into <div id="ocoa-reservation" data-experience="...">
   and posts to /api/reservation (Neon). One component, bilingual (EN/ES). Language is
   detected from the URL path so Spanish pages render the form in Spanish. The submitted
   `experience` value stays canonical (English) so the admin panel stays consistent. */
(function () {
  "use strict";
  var root = document.getElementById("ocoa-reservation");
  if (!root) return;

  // ---- language detection (Spanish page slugs) ----
  var ES_SLUGS = {
    bienestar: 1, evento: 1, "experiencia-completa": 1, gastronomia: 1,
    jardin: 1, "playa-y-piscina": 1, reservacion: 1, "tour-de-vinos-cata": 1,
  };
  var seg = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  var lang = root.getAttribute("data-lang") || (ES_SLUGS[seg] ? "es" : "en");

  // ---- canonical experiences + localized display names ----
  var EXPERIENCES = [
    "Full OcoaBay Experience",
    "Wine Tour & Tasting",
    "BayaOnda Cuisine",
    "Beach & Pool",
    "Garden & Nature",
    "Wellness",
    "Events",
    "OcoaBay Club House",
  ];
  var ES_NAMES = {
    "Full OcoaBay Experience": "Experiencia Completa OcoaBay",
    "Wine Tour & Tasting": "Tour de Vinos y Cata",
    "BayaOnda Cuisine": "Cocina BayaOnda",
    "Beach & Pool": "Playa y Piscina",
    "Garden & Nature": "Jardín y Naturaleza",
    "Wellness": "Bienestar",
    "Events": "Eventos",
    "OcoaBay Club House": "OcoaBay Club House",
  };
  var display = function (canon) { return lang === "es" ? (ES_NAMES[canon] || canon) : canon; };

  // ---- string tables ----
  var STR = {
    en: {
      title: "Reserve Your Experience", reserve: "Reserve: ",
      experience: "Experience *", arrival: "Date of arrival *", guests: "Number of guests *",
      name: "Full name *", email: "Email *", phone: "Phone",
      requests: "Special requests", requestsPh: "Dietary needs, occasion, etc.",
      submit: "Request reservation", sending: "Sending…",
      thanks: function (n) { return "Thank you, " + n + "!"; },
      bodyPre: "Your request for ", bodyPost: " has been received. We'll confirm by email shortly.",
      errNameEmail: "Please enter your name and a valid email.",
      errGeneric: "Something went wrong.", network: "Network error. Please try again.",
    },
    es: {
      title: "Reserva tu Experiencia", reserve: "Reservar: ",
      experience: "Experiencia *", arrival: "Fecha de llegada *", guests: "Número de huéspedes *",
      name: "Nombre completo *", email: "Correo electrónico *", phone: "Teléfono",
      requests: "Solicitudes especiales", requestsPh: "Necesidades dietéticas, ocasión, etc.",
      submit: "Solicitar reserva", sending: "Enviando…",
      thanks: function (n) { return "¡Gracias, " + n + "!"; },
      bodyPre: "Tu solicitud para ", bodyPost: " ha sido recibida. Te confirmaremos por correo en breve.",
      errNameEmail: "Por favor ingresa tu nombre y un correo electrónico válido.",
      errGeneric: "Algo salió mal.", network: "Error de red. Por favor intenta de nuevo.",
    },
  };
  var t = STR[lang] || STR.en;

  var preset = root.getAttribute("data-experience") || "";
  var title = preset ? t.reserve + display(preset) : t.title;

  var opts = EXPERIENCES.map(function (e) {
    return '<option value="' + e + '"' + (e === preset ? " selected" : "") + ">" + display(e) + "</option>";
  }).join("");

  root.innerHTML =
    '<div class="ocoa-resv-card"><h3>' + title + "</h3>" +
    '<form id="ocoa-resv-form" class="ocoa-resv">' +
    '<div class="ocoa-resv-grid">' +
    "<label>" + t.experience + '<select name="experience" required>' + opts + "</select></label>" +
    "<label>" + t.arrival + '<input type="date" name="arrival_date" required></label>' +
    "<label>" + t.guests + '<input type="number" name="people" min="1" value="2" required></label>' +
    "<label>" + t.name + '<input name="name" required></label>' +
    "<label>" + t.email + '<input type="email" name="email" required></label>' +
    "<label>" + t.phone + '<input name="phone"></label>' +
    "</div>" +
    "<label>" + t.requests + '<textarea name="message" rows="3" placeholder="' + t.requestsPh + '"></textarea></label>' +
    '<div class="ocoa-resv-msg" id="ocoa-resv-msg"></div>' +
    '<button type="submit" class="ocoa-btn ocoa-btn-primary" id="ocoa-resv-btn">' + t.submit + "</button>" +
    "</form></div>";

  var form = document.getElementById("ocoa-resv-form");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("ocoa-resv-msg");
    var btn = document.getElementById("ocoa-resv-btn");
    var data = {};
    form.querySelectorAll("input, select, textarea").forEach(function (i) { if (i.name) data[i.name] = i.value; });
    msg.textContent = ""; msg.className = "ocoa-resv-msg";
    if (!data.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || "")) { msg.textContent = t.errNameEmail; return; }
    btn.disabled = true; btn.textContent = t.sending;
    fetch("/api/reservation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          form.innerHTML = '<div class="ocoa-resv-ok"><h4>' + t.thanks(data.name) + "</h4><p>" + t.bodyPre +
            "<strong>" + display(data.experience) + "</strong>" + t.bodyPost + "</p></div>";
        } else { msg.textContent = res.error || t.errGeneric; btn.disabled = false; btn.textContent = t.submit; }
      })
      .catch(function () { msg.textContent = t.network; btn.disabled = false; btn.textContent = t.submit; });
  });
})();
