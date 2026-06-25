// Email abstraction — Resend-ready. No-ops (logs) until RESEND_API_KEY is set,
// so the whole order/account flow works now and "lights up" the moment you add the key.

const FROM = "OcoaBay <no-reply@ocoabay.com>";
const money = (c, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format((c || 0) / 100);

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:skipped no RESEND_API_KEY] to=${to} subject="${subject}"`);
    return { skipped: true };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM || FROM, to, subject, html }),
  });
  return r.ok ? { ok: true } : { error: await r.text() };
}

function layout(title, body) {
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2b1a12">
    <h2 style="color:#6b3f2a">${title}</h2>${body}
    <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#999">OcoaBay · Azua, Dominican Republic · ocoabay.com</p></div>`;
}

export async function sendOrderEmail(env, { orderId, email, name, priced }) {
  const rows = (priced.lines || []).map(
    (l) => `<tr><td>${l.name} × ${l.qty}</td><td align="right">${money(l.line_total_cents, priced.currency)}</td></tr>`
  ).join("");
  const html = layout(`Thank you, ${name}!`, `
    <p>We've received your order <strong>${String(orderId).slice(0, 8)}</strong>. We'll be in touch to arrange payment.</p>
    <table style="width:100%;border-collapse:collapse">${rows}
      <tr><td><strong>Subtotal</strong></td><td align="right">${money(priced.subtotal_cents, priced.currency)}</td></tr>
      ${priced.discount_cents ? `<tr><td>Discount</td><td align="right">−${money(priced.discount_cents, priced.currency)}</td></tr>` : ""}
      <tr><td>Shipping</td><td align="right">${money(priced.shipping_cents, priced.currency)}</td></tr>
      <tr><td>Tax</td><td align="right">${money(priced.tax_cents, priced.currency)}</td></tr>
      <tr><td><strong>Total</strong></td><td align="right"><strong>${money(priced.total_cents, priced.currency)}</strong></td></tr>
    </table>`);
  return sendEmail(env, { to: email, subject: `Your OcoaBay order ${String(orderId).slice(0, 8)}`, html });
}

export async function sendWelcomeEmail(env, { email, name }) {
  return sendEmail(env, { to: email, subject: "Welcome to OcoaBay", html: layout(`Welcome, ${name}!`, "<p>Your account is ready. You can now check out faster and track your orders.</p>") });
}

// Full Experience 3-course menu (shown in the confirmation email). TODO: replace the
// sample dishes with the real seasonal menu provided by OcoaBay.
const FULL_EXPERIENCE_MENU = {
  en: ["<strong>Starter:</strong> Farm garden salad with house vinaigrette",
       "<strong>Main:</strong> Wood-oven chef's selection (meat / fish / vegetarian)",
       "<strong>Dessert:</strong> Organic dessert of the day"],
  es: ["<strong>Entrada:</strong> Ensalada de la huerta con vinagreta de la casa",
       "<strong>Plato fuerte:</strong> Selección del chef al horno de leña (carne / pescado / vegetariano)",
       "<strong>Postre:</strong> Postre orgánico del día"],
};

// Booking confirmation / request email. Loads the reservation + service + slot and renders EN/ES.
export async function sendBookingEmail(env, { sql, reservationId, arrange = false }) {
  const rows = await sql`select r.email, r.name, r.language, r.party_size, r.state,
    r.subtotal_cents, r.tax_cents, r.service_charge_cents, r.total_cents,
    s.slug, s.name_en, s.name_es, s.config, a.starts_at
    from reservations r join services s on s.id = r.service_id join availability_slots a on a.id = r.slot_id
    where r.id = ${reservationId}`;
  if (!rows.length) return { error: "reservation not found" };
  const r = rows[0];
  const es = r.language === "es";
  const cur = "USD";
  const when = new Intl.DateTimeFormat(es ? "es-DO" : "en-US",
    { dateStyle: "full", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(r.starts_at));
  const svcName = es ? r.name_es : r.name_en;
  const cfg = r.config || {};

  const t = es ? {
    subj: `Tu reserva en OcoaBay — ${svcName}`,
    hi: `¡Gracias, ${r.name}!`,
    got: arrange ? "Hemos recibido tu solicitud de reserva." : "Tu reserva está confirmada.",
    exp: "Experiencia", when: "Fecha y hora", guests: "Huéspedes",
    subtotal: "Subtotal", itbis: "ITBIS (18%)", propina: "Propina Legal (10%)", total: "Total",
    arrange: "Te contactaremos para coordinar el pago.",
    clubhouse: "Pago por consumo en el lugar. Aplica compra mínima à la carte. Uso de piscina y Club House 11:00–18:30.",
    menu: "Menú de 3 tiempos (sujeto a disponibilidad de temporada):",
    policy: "Política: reprogramación permitida hasta 72 h antes; no hay reembolsos.",
  } : {
    subj: `Your OcoaBay reservation — ${svcName}`,
    hi: `Thank you, ${r.name}!`,
    got: arrange ? "We've received your reservation request." : "Your reservation is confirmed.",
    exp: "Experience", when: "Date & time", guests: "Guests",
    subtotal: "Subtotal", itbis: "ITBIS (18%)", propina: "Legal Tip (10%)", total: "Total",
    arrange: "We'll contact you to arrange payment.",
    clubhouse: "Pay by consumption on-site. Minimum à la carte purchase applies. Pool & Club House use 11:00–18:30.",
    menu: "3-course menu (subject to seasonal availability):",
    policy: "Policy: reschedule allowed up to 72h before; no refunds.",
  };

  let body = `<p>${t.got}</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td>${t.exp}</td><td align="right"><strong>${svcName}</strong></td></tr>
      <tr><td>${t.when}</td><td align="right">${when}</td></tr>
      <tr><td>${t.guests}</td><td align="right">${r.party_size}</td></tr>
    </table>`;

  if (r.total_cents > 0) {
    body += `<table style="width:100%;border-collapse:collapse;margin-top:10px">
      <tr><td>${t.subtotal}</td><td align="right">${money(r.subtotal_cents, cur)}</td></tr>
      ${r.tax_cents ? `<tr><td>${t.itbis}</td><td align="right">${money(r.tax_cents, cur)}</td></tr>` : ""}
      ${r.service_charge_cents ? `<tr><td>${t.propina}</td><td align="right">${money(r.service_charge_cents, cur)}</td></tr>` : ""}
      <tr><td><strong>${t.total}</strong></td><td align="right"><strong>${money(r.total_cents, cur)}</strong></td></tr>
    </table>`;
  }

  if (cfg.menu_in_email) {
    const items = (es ? FULL_EXPERIENCE_MENU.es : FULL_EXPERIENCE_MENU.en).map((i) => `<li>${i}</li>`).join("");
    body += `<p style="margin-top:14px">${t.menu}</p><ul>${items}</ul>`;
  }
  if (r.slug === "club-house") body += `<p style="margin-top:14px">${t.clubhouse}</p>`;
  if (arrange) body += `<p>${t.arrange}</p>`;
  body += `<p style="font-size:13px;color:#777;margin-top:14px">${t.policy}</p>`;

  return sendEmail(env, { to: r.email, subject: t.subj, html: layout(t.hi, body) });
}

async function loadResv(sql, id) {
  const rows = await sql`select r.email, r.name, r.language, r.party_size, a.starts_at,
    s.name_en, s.name_es from reservations r join services s on s.id = r.service_id
    join availability_slots a on a.id = r.slot_id where r.id = ${id}`;
  return rows[0] || null;
}

// Payment link (CS-initiated booking) — bilingual, with a clear pay button.
export async function sendPaymentLink(env, { sql, reservationId, url }) {
  const rows = await sql`select r.email, r.name, r.language, r.party_size, r.subtotal_cents, r.tax_cents,
    r.service_charge_cents, r.total_cents, a.starts_at, s.name_en, s.name_es
    from reservations r join services s on s.id = r.service_id join availability_slots a on a.id = r.slot_id
    where r.id = ${reservationId}`;
  if (!rows.length) return;
  const r = rows[0]; const es = r.language === "es"; const cur = "USD";
  const svcName = es ? r.name_es : r.name_en;
  const when = new Intl.DateTimeFormat(es ? "es-DO" : "en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(r.starts_at));
  const t = es
    ? { subj: "Completa tu reserva en OcoaBay", hi: `¡Hola, ${r.name}!`, intro: "Tu reserva está lista. Completa el pago de forma segura para confirmarla:",
        exp: "Experiencia", when: "Fecha y hora", guests: "Huéspedes", total: "Total", itbis: "ITBIS (18%)", propina: "Propina Legal (10%)", sub: "Subtotal",
        pay: "Pagar ahora", policy: "Reprogramación hasta 72 h antes. No hay reembolsos." }
    : { subj: "Complete your OcoaBay booking", hi: `Hi ${r.name}!`, intro: "Your reservation is ready. Complete payment securely to confirm it:",
        exp: "Experience", when: "Date & time", guests: "Guests", total: "Total", itbis: "ITBIS (18%)", propina: "Legal Tip (10%)", sub: "Subtotal",
        pay: "Pay now", policy: "Reschedule allowed up to 72h before. No refunds." };
  const body = `<p>${t.intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:8px 0">
      <tr><td>${t.exp}</td><td align="right"><strong>${svcName}</strong></td></tr>
      <tr><td>${t.when}</td><td align="right">${when}</td></tr>
      <tr><td>${t.guests}</td><td align="right">${r.party_size}</td></tr>
      <tr><td>${t.sub}</td><td align="right">${money(r.subtotal_cents, cur)}</td></tr>
      ${r.tax_cents ? `<tr><td>${t.itbis}</td><td align="right">${money(r.tax_cents, cur)}</td></tr>` : ""}
      ${r.service_charge_cents ? `<tr><td>${t.propina}</td><td align="right">${money(r.service_charge_cents, cur)}</td></tr>` : ""}
      <tr><td><strong>${t.total}</strong></td><td align="right"><strong>${money(r.total_cents, cur)}</strong></td></tr>
    </table>
    <p style="text-align:center;margin:22px 0"><a href="${url}" style="background:#6b3f2a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px">${t.pay}</a></p>
    <p style="font-size:12px;color:#999">${t.policy}</p>`;
  return sendEmail(env, { to: r.email, subject: t.subj, html: layout(t.hi, body) });
}

// Reminder ~24-48h before the experience.
export async function sendBookingReminder(env, { sql, reservationId }) {
  const r = await loadResv(sql, reservationId); if (!r) return;
  const es = r.language === "es";
  const svcName = es ? r.name_es : r.name_en;
  const when = new Intl.DateTimeFormat(es ? "es-DO" : "en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Santo_Domingo" }).format(new Date(r.starts_at));
  const subj = es ? `Recordatorio: tu reserva en OcoaBay` : `Reminder: your OcoaBay reservation`;
  const hi = es ? `¡Te esperamos, ${r.name}!` : `See you soon, ${r.name}!`;
  const body = es
    ? `<p>Este es un recordatorio de tu reserva para <strong>${svcName}</strong>.</p><p><strong>${when}</strong> · ${r.party_size} huésped(es)</p><p>Llega 10 minutos antes. ¿Necesitas reprogramar? Solo es posible con más de 72 h de antelación.</p>`
    : `<p>A friendly reminder of your reservation for <strong>${svcName}</strong>.</p><p><strong>${when}</strong> · ${r.party_size} guest(s)</p><p>Please arrive 10 minutes early. Need to reschedule? Only possible more than 72h ahead.</p>`;
  return sendEmail(env, { to: r.email, subject: subj, html: layout(hi, body) });
}

// Thank-you + review request after the visit.
export async function sendThankYou(env, { sql, reservationId }) {
  const r = await loadResv(sql, reservationId); if (!r) return;
  const es = r.language === "es";
  const svcName = es ? r.name_es : r.name_en;
  const subj = es ? `¡Gracias por visitar OcoaBay!` : `Thank you for visiting OcoaBay!`;
  const hi = es ? `¡Gracias, ${r.name}!` : `Thank you, ${r.name}!`;
  const body = es
    ? `<p>Esperamos que hayas disfrutado <strong>${svcName}</strong>. Nos encantaría conocer tu opinión — ¿nos dejas una reseña en Google?</p><p>¡Vuelve pronto! Reserva en <a href="https://ocoabay.com/book/">ocoabay.com/book</a>.</p>`
    : `<p>We hope you enjoyed <strong>${svcName}</strong>. We'd love your feedback — would you leave us a Google review?</p><p>Come back soon! Book at <a href="https://ocoabay.com/book/">ocoabay.com/book</a>.</p>`;
  return sendEmail(env, { to: r.email, subject: subj, html: layout(hi, body) });
}
