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
