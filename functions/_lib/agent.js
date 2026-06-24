// OcoaBay AI customer-service agent — Anthropic tool-use loop, grounded in kb_documents.
// Gated: if ANTHROPIC_API_KEY is absent the caller returns a graceful fallback.
import { getService, priceBooking } from "./booking.js";

const API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const SERVICES = ["wine-tour", "full-experience", "club-house"];

export async function loadKB(sql, lang) {
  const rows = await sql`select title, body from kb_documents where lang = ${lang} order by id`;
  return rows.map((r) => `## ${r.title}\n${r.body}`).join("\n\n");
}

export const TOOLS = [
  { name: "check_availability", description: "Get upcoming available dates/times and remaining seats for a service. Use before suggesting a booking.",
    input_schema: { type: "object", properties: { service: { type: "string", enum: SERVICES }, from: { type: "string", description: "optional YYYY-MM-DD" }, to: { type: "string", description: "optional YYYY-MM-DD" } }, required: ["service"] } },
  { name: "get_pricing", description: "Compute the exact price for a service and party size, including ITBIS (18%) and Propina Legal (10%).",
    input_schema: { type: "object", properties: { service: { type: "string", enum: SERVICES }, party_size: { type: "integer" } }, required: ["service", "party_size"] } },
  { name: "get_booking_link", description: "Return the URL the customer should open to complete a booking for a service.",
    input_schema: { type: "object", properties: { service: { type: "string", enum: SERVICES }, lang: { type: "string", enum: ["en", "es"] } }, required: ["service"] } },
  { name: "lookup_reservation", description: "Look up a customer's existing reservations by email.",
    input_schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
  { name: "save_lead", description: "Save the customer's contact details as a lead when they show interest but haven't booked.",
    input_schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, interest: { type: "string" } }, required: ["email"] } },
  { name: "escalate_to_human", description: "Hand the conversation to a human for complaints, high-value events (weddings/large groups), or anything you cannot resolve.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
];

export async function executeTool(sql, env, name, input, ctx) {
  try {
    if (name === "check_availability") {
      const svc = await getService(sql, input.service);
      if (!svc) return { error: "unknown service" };
      const lead = (svc.capacity_rules && svc.capacity_rules.lead_time_min) || 0;
      const rows = await sql`select starts_at, label, capacity, booked, held from availability_slots
        where service_id = ${svc.id} and status='open' and starts_at > now() + make_interval(mins => ${lead})
        order by starts_at limit 60`;
      const slots = rows.map((r) => ({ date: new Date(r.starts_at).toISOString().slice(0, 10), time: r.label, remaining: Math.max(0, r.capacity - r.booked - r.held) }))
        .filter((s) => s.remaining > 0).slice(0, 12);
      return { service: input.service, next_available: slots };
    }
    if (name === "get_pricing") {
      const svc = await getService(sql, input.service);
      if (!svc) return { error: "unknown service" };
      if (!svc.base_price_cents) return { service: input.service, note: "Club House is à la carte, paid by consumption on-site (minimum purchase). No fixed price." };
      const p = await priceBooking(sql, svc, input.party_size, []);
      return { service: input.service, party_size: input.party_size, currency: p.currency,
        subtotal: p.subtotal_cents / 100, itbis_18: p.tax_cents / 100, propina_10: p.service_charge_cents / 100, total: p.total_cents / 100 };
    }
    if (name === "get_booking_link") {
      const lang = input.lang || ctx.lang || "en";
      return { url: `https://ocoabay.com/book/?service=${encodeURIComponent(input.service)}&lang=${lang}` };
    }
    if (name === "lookup_reservation") {
      const rows = await sql`select r.state, s.name_en service, r.arrival_date, r.party_size, r.total_cents
        from reservations r left join services s on s.id = r.service_id
        where lower(r.email) = lower(${input.email}) order by r.created_at desc limit 10`;
      return { reservations: rows.map((r) => ({ status: r.state, service: r.service, date: r.arrival_date, guests: r.party_size, total: r.total_cents ? r.total_cents / 100 : null })) };
    }
    if (name === "save_lead") {
      let c = await sql`select id from customers where email = ${input.email}`;
      if (!c.length) await sql`insert into customers (email, name, phone, language) values (${input.email}, ${input.name || null}, ${input.phone || null}, ${ctx.lang || "en"})`;
      else if (input.name || input.phone) await sql`update customers set name = coalesce(${input.name || null}, name), phone = coalesce(${input.phone || null}, phone) where id = ${c[0].id}`;
      return { saved: true };
    }
    if (name === "escalate_to_human") {
      if (ctx.conversationId) await sql`update conversations set status = 'handoff' where id = ${ctx.conversationId}`;
      return { escalated: true, message: "A team member will follow up shortly." };
    }
    return { error: "unknown tool" };
  } catch (e) { return { error: e.message }; }
}

function systemPrompt(kb, lang) {
  return `You are the OcoaBay customer-service assistant for a Dominican Republic vineyard, winery, Club House restaurant and online store.
Reply in ${lang === "es" ? "Spanish" : "English"}, warmly and concisely. Keep answers short and helpful.

Rules:
- Use ONLY the knowledge base and tools below for facts. NEVER invent prices, availability, taxes, or policies.
- For prices/availability ALWAYS call the tools (get_pricing / check_availability) — do not guess.
- To help someone book, call get_booking_link and share the URL.
- Always remind, when relevant, that experiences add 18% ITBIS + 10% Propina Legal, and that there are no refunds (reschedule allowed >72h ahead).
- For complaints, weddings/large/corporate events, or anything you can't answer, call escalate_to_human.
- If the user shares contact details and intent but hasn't booked, call save_lead.

KNOWLEDGE BASE:
${kb}`;
}

export async function callAnthropic(env, system, messages, tools) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AGENT_MODEL || DEFAULT_MODEL, max_tokens: 700, system, messages, tools }),
  });
  return r.json();
}

// Runs the full tool-use loop. history: [{role:'user'|'assistant', content}]; returns {text, toolsCalled, escalated}.
export async function runAgent(env, sql, { lang, conversationId, history }) {
  const kb = await loadKB(sql, lang);
  const system = systemPrompt(kb, lang);
  const messages = history.slice();
  const toolsCalled = [];
  let escalated = false;

  for (let hop = 0; hop < 5; hop++) {
    const res = await callAnthropic(env, system, messages, TOOLS);
    if (res.error) return { text: null, error: res.error.message || "AI error", toolsCalled, escalated };
    messages.push({ role: "assistant", content: res.content });
    const toolUses = (res.content || []).filter((b) => b.type === "tool_use");
    if (!toolUses.length) {
      const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text, toolsCalled, escalated, usage: res.usage };
    }
    const results = [];
    for (const tu of toolUses) {
      toolsCalled.push(tu.name);
      if (tu.name === "escalate_to_human") escalated = true;
      const out = await executeTool(sql, env, tu.name, tu.input || {}, { lang, conversationId });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: lang === "es" ? "Permíteme conectarte con nuestro equipo." : "Let me connect you with our team.", toolsCalled, escalated: true };
}
