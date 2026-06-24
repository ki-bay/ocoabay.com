/* OcoaBay reservation/booking form — renders into <div id="ocoa-reservation" data-experience="...">
   and posts to /api/reservation (Neon). One component, used on every experience page. */
(function () {
  "use strict";
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
  var root = document.getElementById("ocoa-reservation");
  if (!root) return;
  var preset = root.getAttribute("data-experience") || "";
  var title = root.getAttribute("data-title") || "Reserve Your Experience";

  var opts = EXPERIENCES.map(function (e) {
    return '<option value="' + e + '"' + (e === preset ? " selected" : "") + ">" + e + "</option>";
  }).join("");

  root.innerHTML =
    '<div class="ocoa-resv-card"><h3>' + title + "</h3>" +
    '<form id="ocoa-resv-form" class="ocoa-resv">' +
    '<div class="ocoa-resv-grid">' +
    '<label>Experience *<select name="experience" required>' + opts + "</select></label>" +
    '<label>Date of arrival *<input type="date" name="arrival_date" required></label>' +
    '<label>Number of guests *<input type="number" name="people" min="1" value="2" required></label>' +
    '<label>Full name *<input name="name" required></label>' +
    '<label>Email *<input type="email" name="email" required></label>' +
    '<label>Phone<input name="phone"></label>' +
    "</div>" +
    '<label>Special requests<textarea name="message" rows="3" placeholder="Dietary needs, occasion, etc."></textarea></label>' +
    '<div class="ocoa-resv-msg" id="ocoa-resv-msg"></div>' +
    '<button type="submit" class="ocoa-btn ocoa-btn-primary" id="ocoa-resv-btn">Request reservation</button>' +
    "</form></div>";

  var form = document.getElementById("ocoa-resv-form");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("ocoa-resv-msg");
    var btn = document.getElementById("ocoa-resv-btn");
    var data = {};
    form.querySelectorAll("input, select, textarea").forEach(function (i) { if (i.name) data[i.name] = i.value; });
    msg.textContent = ""; msg.className = "ocoa-resv-msg";
    if (!data.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || "")) { msg.textContent = "Please enter your name and a valid email."; return; }
    btn.disabled = true; btn.textContent = "Sending…";
    fetch("/api/reservation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          form.innerHTML = '<div class="ocoa-resv-ok"><h4>Thank you, ' + data.name + "!</h4><p>Your request for <strong>" + data.experience +
            "</strong> has been received. We'll confirm by email shortly.</p></div>";
        } else { msg.textContent = res.error || "Something went wrong."; btn.disabled = false; btn.textContent = "Request reservation"; }
      })
      .catch(function () { msg.textContent = "Network error. Please try again."; btn.disabled = false; btn.textContent = "Request reservation"; });
  });
})();
