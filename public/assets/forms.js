/* OcoaBay forms — wires the mirrored Elementor forms (contact, reservation,
   newsletter) to /api/contact (Neon). Shows the native Elementor success/error UI. */
(function () {
  "use strict";

  function fieldsToPayload(form) {
    var data = { form: form.getAttribute("name") || "form", source_page: location.pathname };
    form.querySelectorAll("input, textarea, select").forEach(function (el) {
      if (!el.name) return;
      var m = el.name.match(/^form_fields\[(.+)\]$/);
      var key = m ? m[1] : el.name;
      if (/email/i.test(key)) data.email = el.value;
      else if (/(^name$|your-name|full.?name)/i.test(key)) data.name = el.value;
      else if (/(message|comment)/i.test(key)) data.message = el.value;
      else data[key] = el.value; // keep extras (phone/subject/etc.) in raw
    });
    return data;
  }

  function setMessage(form, ok, text) {
    form.querySelectorAll(".elementor-message").forEach(function (n) { n.remove(); });
    var div = document.createElement("div");
    div.className = "elementor-message " + (ok ? "elementor-message-success" : "elementor-message-danger");
    div.setAttribute("role", "alert");
    div.textContent = text;
    form.appendChild(div);
  }

  document.addEventListener("submit", function (e) {
    var form = e.target.closest("form.elementor-form, form[name='Newsletter Ocoabay']");
    if (!form) return;
    e.preventDefault();

    var payload = fieldsToPayload(form);
    if (!payload.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) {
      setMessage(form, false, "Please enter a valid email address.");
      return;
    }
    var btn = form.querySelector("button[type=submit], .elementor-button");
    if (btn) btn.classList.add("elementor-button-state");

    fetch("/api/contact", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, j: j }; }); })
      .then(function (res) {
        if (btn) btn.classList.remove("elementor-button-state");
        if (res.ok) {
          setMessage(form, true, /newsletter/i.test(payload.form) ? "Thank you for subscribing!" : "Thank you! Your message has been sent.");
          form.reset();
        } else {
          setMessage(form, false, (res.j && res.j.error) || "Something went wrong. Please try again.");
        }
      })
      .catch(function () {
        if (btn) btn.classList.remove("elementor-button-state");
        setMessage(form, false, "Network error. Please try again.");
      });
  }, true);
})();
