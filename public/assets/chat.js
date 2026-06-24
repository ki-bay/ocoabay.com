/* OcoaBay web chat widget — talks to /api/agent. Bilingual, persists the conversation id in
   sessionStorage. Injected site-wide by the Pages middleware. */
(function () {
  "use strict";
  if (window.__ocoaChat) return; window.__ocoaChat = true;
  if (document.getElementById("ocoa-chat-btn")) return;

  var ES_SLUGS = { inicio:1,mision:1,fundadores:1,sostenibilidad:1,comunidad:1,"media-spa":1,vino:1,experiencias:1,
    "experiencia-completa":1,"tour-de-vinos-cata":1,"playa-y-piscina":1,gastronomia:1,jardin:1,evento:1,residencias:1,
    bienestar:1,reservacion:1,contacto:1 };
  var seg = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  var qLang = new URLSearchParams(location.search).get("lang");
  var lang = (qLang === "es" || ES_SLUGS[seg]) ? "es" : "en";

  var T = lang === "es"
    ? { title: "Asistente OcoaBay", greet: "¡Hola! Soy el asistente de OcoaBay. ¿Te ayudo a reservar una experiencia o con alguna pregunta?", ph: "Escribe un mensaje…", send: "Enviar", err: "Error de red. Intenta de nuevo." }
    : { title: "OcoaBay Assistant", greet: "Hi! I'm the OcoaBay assistant. Want help booking an experience or have a question?", ph: "Type a message…", send: "Send", err: "Network error. Please try again." };

  var convId = sessionStorage.getItem("ocoa_conv") || null;

  var btn = document.createElement("button");
  btn.id = "ocoa-chat-btn"; btn.setAttribute("aria-label", T.title); btn.innerHTML = "&#128172;";
  document.body.appendChild(btn);

  var box = document.createElement("div");
  box.id = "ocoa-chat";
  box.innerHTML =
    '<div class="ocoa-chat-h"><strong>' + T.title + '</strong><button id="ocoa-chat-x" aria-label="close">&times;</button></div>' +
    '<div class="ocoa-chat-body" id="ocoa-chat-body"></div>' +
    '<div class="ocoa-chat-typing" id="ocoa-chat-typing" style="display:none">…</div>' +
    '<form class="ocoa-chat-f" id="ocoa-chat-f"><input id="ocoa-chat-in" placeholder="' + T.ph + '" autocomplete="off"><button type="submit">' + T.send + "</button></form>";
  document.body.appendChild(box);

  var body = box.querySelector("#ocoa-chat-body");
  var input = box.querySelector("#ocoa-chat-in");
  var typing = box.querySelector("#ocoa-chat-typing");
  var greeted = false;

  function esc(s) { return (s || "").replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
  function add(role, text) {
    var m = document.createElement("div"); m.className = "ocoa-m " + (role === "user" ? "u" : "a");
    m.innerHTML = '<div class="b">' + linkify(text) + "</div>"; body.appendChild(m); body.scrollTop = body.scrollHeight;
  }

  function open() {
    box.classList.add("open"); btn.style.display = "none";
    if (!greeted) { add("assistant", T.greet); greeted = true; }
    input.focus();
  }
  function close() { box.classList.remove("open"); btn.style.display = "block"; }
  btn.onclick = open;
  box.querySelector("#ocoa-chat-x").onclick = close;

  box.querySelector("#ocoa-chat-f").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    add("user", text); input.value = ""; input.disabled = true; typing.style.display = "block";
    fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, conversation_id: convId, lang: lang }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        typing.style.display = "none"; input.disabled = false; input.focus();
        if (d.conversation_id) { convId = d.conversation_id; sessionStorage.setItem("ocoa_conv", convId); }
        add("assistant", d.reply || T.err);
      })
      .catch(function () { typing.style.display = "none"; input.disabled = false; add("assistant", T.err); });
  });
})();
