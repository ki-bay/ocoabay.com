// Seed/refresh the AI knowledge base (kb_documents), EN + ES. Idempotent. Run: node db/seed-kb.mjs
import { neon } from "@neondatabase/serverless";
import fs from "fs";
const raw = fs.readFileSync(".dev.vars", "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^["']|["']$/g, "");
let sql; try { sql = neon(raw); } catch { console.log("conn fail"); process.exit(1); }

const DOCS = [
  { slug: "about", lang: "en", title: "About OcoaBay", body:
    `OcoaBay is a vineyard and winery in Bahía de Ocoa, Azua, Dominican Republic — producer of the first wine made in the DR from locally grown grapes. We offer guided wine experiences, a farm-to-table Club House restaurant with pool, and an online store of wines and organic products. Languages: English and Spanish. Operating days for experiences and the Club House: Thursday, Friday, Saturday and Sunday.` },
  { slug: "about", lang: "es", title: "Sobre OcoaBay", body:
    `OcoaBay es un viñedo y bodega en Bahía de Ocoa, Azua, República Dominicana — productor del primer vino hecho en RD con uvas cultivadas localmente. Ofrecemos experiencias guiadas de vino, un restaurante Club House de la granja a la mesa con piscina, y una tienda en línea de vinos y productos orgánicos. Idiomas: español e inglés. Días de operación para experiencias y Club House: jueves, viernes, sábado y domingo.` },

  { slug: "experiences", lang: "en", title: "Experiences & prices", body:
    `WINE TOUR EXPERIENCE — USD $65 per person (+ taxes). 90 minutes. Guided tasting of OcoaBay wines and a cheese table with our signature organic jams, plus an electric-car tour of the vineyards and the bodega. Available in three daily sessions: 10:30, 14:00 and 16:00 (each up to 18 guests).
FULL OCOABAY EXPERIENCE — USD $145 per person (+ taxes). Includes the Wine Tour plus a welcome toast, a 3-course organic wood-oven menu (choice per person), and use of the pool and Club House from 11:00 to 18:30. Available at 14:00 and 16:00 (each up to 18 guests).
OCOABAY CLUB HOUSE — reservation only, pay by consumption (à la carte, minimum purchase). Farm-to-table wood-oven cuisine and use of the pool and Club House from 11:00 to 18:30. Up to 100 guests per day; no fixed time slot.
To book: use the booking page at /book/ or any experience page. Taxes below.` },
  { slug: "experiences", lang: "es", title: "Experiencias y precios", body:
    `EXPERIENCIA TOUR DE VINOS — USD $65 por persona (+ impuestos). 90 minutos. Cata guiada de vinos OcoaBay y mesa de quesos con nuestras mermeladas orgánicas, más un recorrido en carro eléctrico por los viñedos y la bodega. Tres sesiones diarias: 10:30, 14:00 y 16:00 (hasta 18 personas cada una).
EXPERIENCIA COMPLETA OCOABAY — USD $145 por persona (+ impuestos). Incluye el Tour de Vinos más un brindis de bienvenida, un menú orgánico de 3 tiempos al horno de leña (a elección por persona), y uso de la piscina y el Club House de 11:00 a 18:30. Disponible a las 14:00 y 16:00 (hasta 18 personas cada una).
OCOABAY CLUB HOUSE — solo con reserva, pago por consumo (à la carte, compra mínima). Cocina de la granja a la mesa al horno de leña y uso de la piscina y Club House de 11:00 a 18:30. Hasta 100 personas por día; sin horario fijo.
Para reservar: usa /book/ o cualquier página de experiencia. Impuestos abajo.` },

  { slug: "taxes-policy", lang: "en", title: "Taxes & booking policy", body:
    `TAXES on experiences and dining: 18% ITBIS (government tax) + 10% Propina Legal (mandatory legal service charge that goes to staff; dine-in / on-premises only). So a $65 Wine Tour totals $83.20 per person; a $145 Full Experience totals $185.60 per person. The online store charges 18% ITBIS only (shipped products are not subject to the 10% service charge).
BOOKING POLICY: reschedule is allowed up to 72 hours before your reservation. Within 72 hours, or for cancellations, there are NO refunds. Prepaid experiences (Wine Tour, Full Experience) are paid online; the Club House is paid on-site by consumption.` },
  { slug: "taxes-policy", lang: "es", title: "Impuestos y política de reservas", body:
    `IMPUESTOS en experiencias y restaurante: 18% ITBIS (impuesto) + 10% Propina Legal (cargo por servicio obligatorio que va al personal; solo consumo en el lugar). Un Tour de Vinos de $65 totaliza $83.20 por persona; una Experiencia Completa de $145 totaliza $185.60 por persona. La tienda en línea cobra solo 18% ITBIS (los productos enviados no llevan el 10%).
POLÍTICA DE RESERVAS: se permite reprogramar hasta 72 horas antes. Dentro de las 72 horas, o en cancelaciones, NO hay reembolsos. Las experiencias prepagas (Tour de Vinos, Experiencia Completa) se pagan en línea; el Club House se paga en el lugar por consumo.` },

  { slug: "location-contact", lang: "en", title: "Location & contact", body:
    `Location: Bahía de Ocoa, Carretera Hatillo Palmar de Ocoa, Azua 71003, Dominican Republic. Phone: +1 (849) 876-6563 and +1 (829) 745-0036. Reach us via the website chat, WhatsApp, Instagram or the contact form. Open Thursday–Sunday.` },
  { slug: "location-contact", lang: "es", title: "Ubicación y contacto", body:
    `Ubicación: Bahía de Ocoa, Carretera Hatillo Palmar de Ocoa, Azua 71003, República Dominicana. Teléfono: +1 (849) 876-6563 y +1 (829) 745-0036. Contáctanos por el chat del sitio, WhatsApp, Instagram o el formulario de contacto. Abierto de jueves a domingo.` },

  { slug: "store", lang: "en", title: "Online store", body:
    `The OcoaBay store sells our wines and signature organic products (jams, honey). Prices in USD. Shipping within the Dominican Republic is a $5 flat rate; tax is 18% ITBIS. Browse at /store/ or /products/. Checkout is online.` },
  { slug: "store", lang: "es", title: "Tienda en línea", body:
    `La tienda OcoaBay vende nuestros vinos y productos orgánicos (mermeladas, miel). Precios en USD. El envío dentro de República Dominicana tiene tarifa fija de $5; impuesto 18% ITBIS. Explora en /store/ o /products/. Pago en línea.` },

  { slug: "faq", lang: "en", title: "FAQ", body:
    `Q: How do I book? Use /book/ (choose Wine Tour, Full Experience or Club House), pick a date and time, enter guests and details. Q: Can I get a refund? No — within 72h or on cancellation there are no refunds; you may reschedule more than 72h ahead. Q: Are children/dietary needs handled? Mention dietary needs in your booking; the Full Experience menu can accommodate choices. Q: Languages? English and Spanish. Q: Days open? Thursday to Sunday.` },
  { slug: "faq", lang: "es", title: "Preguntas frecuentes", body:
    `P: ¿Cómo reservo? Usa /book/ (elige Tour de Vinos, Experiencia Completa o Club House), elige fecha y hora, indica huéspedes y datos. P: ¿Hay reembolsos? No — dentro de 72h o en cancelación no hay reembolsos; puedes reprogramar con más de 72h. P: ¿Necesidades dietéticas? Indícalas en tu reserva; el menú de la Experiencia Completa admite opciones. P: ¿Idiomas? Español e inglés. P: ¿Días? De jueves a domingo.` },
];

let n = 0;
for (const d of DOCS) {
  await sql`insert into kb_documents (slug, lang, title, body, tags) values (${d.slug}, ${d.lang}, ${d.title}, ${d.body}, ${d.tags || null})
    on conflict (slug, lang) do update set title = excluded.title, body = excluded.body, updated_at = now()`;
  n++;
}
const c = await sql`select count(*)::int n from kb_documents`;
console.log(`upserted ${n} docs; kb_documents now: ${c[0].n}`);
