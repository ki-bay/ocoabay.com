# OcoaBay — Phase 1 Spec: Reservation Core (Experiences, Tours & Club House)

Concrete spec for the first build phase, using the parameters you confirmed. Covers the
**guided sessions** (Wine Tour / Full Experience), the **Club House restaurant** (à la carte),
pricing, the experience **tax model**, availability generation, and the **cancellation policy**.
Weddings / corporate events / buffet are deferred (capture + pricing not yet defined).

> Builds on `IMPLEMENTATION-PLAN.md`. Nothing here touches the live store/experiences pages;
> it adds new tables + `/api/booking/*` endpoints.

---

## 1. Confirmed parameters

### Guided sessions — **18 seats EACH product, per session** (independent counters)
Confirmed: Wine Tour and Full Experience have **separate** 18-seat pools in the same time slot
(up to 36 guests total per session across both products). ⇒ one `availability_slots` row per
**(product, date, time)** — no shared session inventory.

| Session | Time | Duration | Capacity (each) | Lunch | Wine Tour | Full Experience |
|---|---|---|---|---|---|---|
| Morning | 10:30 | 90 min | 18 | no | ✅ | — |
| Afternoon | 14:00 | 90 min | 18 | yes | ✅ (+lunch) | ✅ |
| Evening | 16:00 | 90 min | 18 | yes | ✅ (+lunch) | ✅ |

### Products & pricing (price per person, **+ 28% tax**)
| Product | Price p/p | ITBIS / Propina | Includes | Bookable at |
|---|---|---|---|---|
| **Wine Tour Experience** | **USD $65** | 18% + 10% | Guided tasting + cheese/jams, electric-car tour of vineyards & bodega, 90 min | all 3 sessions |
| **OcoaBay Full Experience** | **USD $145** | 18% + 10% | Wine Tour + welcome toast + 3-course wood-oven menu (choose per person) + pool/Clubhouse 11:00–18:30 | 14:00, 16:00 (lunch sessions) |
| **OcoaBay Club House** (restaurant) | **by consumption** (à la carte, min. purchase) | 18% + 10% (applied on-site) | Farm-to-table wood-oven à la carte + pool/Clubhouse 11:00–18:30 | any day, **no time slot** |

**Tax & service-charge model (two separate line items):**
- **ITBIS 18%** — government VAT (a *tax*).
- **Propina Legal 10%** — mandatory *service charge* (DR Labor Code Art. 228), goes entirely to service staff, **dine-in / on-premises only**.

These are shown as **distinct lines** on quotes/receipts (not merged into "tax"):
`Subtotal → ITBIS 18% → Propina Legal 10% → Total` (= 28% uplift on on-premises experiences).

**The retail store stays at 18% only** — products are shipped/take-out, so the Propina Legal does **not** apply (per ProConsumidor/Supreme Court: no service charge on carry-out/delivery). This is why tax/service is now **per-service**, not global. Seasonal product/wine availability may vary (display note).

### Restaurant (Club House à la carte)
- Capacity: **100 covers per full day** (date-level, **no time slots**).
- Reservation only; **no online prepay** — pay by consumption on-site (à la carte, minimum purchase). Booking just holds a cover count for the date.

### Cancellation / reschedule policy (all services)
- **> 72 h before:** reschedule allowed, **no refund**.
- **≤ 72 h before:** no reschedule, **no refund**.
- ⇒ **No cash refunds, ever.** Reschedule is the only remedy, and only outside 72 h.
- Payment mode therefore: **full prepayment online** for fixed-price tours (Wine Tour, Full Experience); **reservation-only** (no charge) for Club House à la carte.

---

## 2. Seed data (Neon)

```sql
-- Services.  tax_bps = ITBIS (1800 = 18%);  service_charge_bps = Propina Legal (1000 = 10%, dine-in).
insert into services (slug, type, name_en, name_es, pricing_model, base_price_cents, deposit_bps, capacity_rules, config) values
('wine-tour',       'tour',      'Wine Tour Experience','Experiencia Tour de Vinos','per_guest', 6500, 0,
   '{"session_cap":18,"lead_time_min":120,"reschedule_cutoff_h":72,"refundable":false}',
   '{"tax_bps":1800,"service_charge_bps":1000,"sessions":["10:30","14:00","16:00"],"lunch_sessions":["14:00","16:00"],"payment":"full"}'),
('full-experience', 'experience','OcoaBay Full Experience','Experiencia Completa OcoaBay','per_guest', 14500, 0,
   '{"session_cap":18,"lead_time_min":120,"reschedule_cutoff_h":72,"refundable":false}',
   '{"tax_bps":1800,"service_charge_bps":1000,"sessions":["14:00","16:00"],"includes_clubhouse":true,"payment":"full"}'),
('club-house',      'restaurant','OcoaBay Club House','OcoaBay Club House','quote', 0, 0,
   '{"daily_cap":100,"reschedule_cutoff_h":72,"refundable":false}',
   '{"tax_bps":1800,"service_charge_bps":1000,"payment":"none","min_purchase":true,"hours":"11:00-18:30"}');
-- Retail store keeps tax_bps=1800, service_charge_bps=0 (shipped/take-out -> no Propina Legal).

-- Optional add-on: lunch on Wine Tour at lunch sessions (price TBC if any)
insert into service_options (service_id, key, name_en, name_es, kind, price_cents, per_guest)
select id, 'lunch', 'Add lunch', 'Agregar almuerzo', 'addon', 0, true from services where slug='wine-tour';

-- Full Experience 3-course menu choice (per person) — choices, no extra cost
insert into service_options (service_id, key, name_en, name_es, kind, price_cents, per_guest)
select id, 'menu-choice', '3-course menu selection', 'Selección menú 3 tiempos', 'menu', 0, true
from services where slug='full-experience';
```

### Availability generation
- **Sessions:** a cron/job generates `availability_slots` **per (product, date, time)** **N days ahead** (e.g. 60). Since caps are **independent (18 each)**, Wine Tour and Full Experience get their **own** slot rows at each time — e.g. `2026-07-01 14:00` produces one `wine-tour` slot (cap 18) and one `full-experience` slot (cap 18). Wine Tour also gets a 10:30 slot; Full Experience does not.
- **Club House:** one slot per **date**, `capacity = 100`, `label='clubhouse-day'`.
- Slot generator skips blocked dates and respects the opening calendar.

---

## 3. Pricing examples (validation targets)

| Booking | Subtotal | ITBIS 18% | Propina 10% | Total |
|---|---|---|---|---|
| Wine Tour × 2 | $130.00 | $23.40 | $13.00 | **$166.40** |
| Full Experience × 2 | $290.00 | $52.20 | $29.00 | **$371.20** |
| Club House (4 covers) | by consumption | — | — | reservation only, $0 online |

`/api/booking/quote` computes these server-side from `services.base_price_cents × party_size`, applies `config.tax_bps` (ITBIS) and `config.service_charge_bps` (Propina Legal) as **separate lines**, and returns the itemised breakdown. Client never sends amounts. Both ITBIS and Propina are computed on the subtotal.

---

## 4. Booking flow per product

**Wine Tour / Full Experience (prepaid):**
1. `GET /api/booking/availability?service=wine-tour&from=&to=` → sessions with `18 − booked − held` left.
2. `POST /api/booking/hold {slot_id, qty}` → atomic hold (15-min TTL).
3. `POST /api/booking/quote` → price + 28% tax.
4. `POST /api/booking/confirm` → reservation `pending_payment` + Stripe PaymentIntent (full amount).
5. Stripe webhook `succeeded` → `confirmed`, `booked += qty`, `held −= qty`, confirmation email (EN/ES).

**Club House (reservation only):**
1. `GET /api/booking/availability?service=club-house&from=&to=` → days with `100 − booked − held` covers left.
2. `POST /api/booking/hold` then `POST /api/booking/confirm` → **straight to `confirmed`** (no payment); confirmation email notes "pay by consumption, minimum à la carte purchase."

**Cancellation/reschedule (all):** `POST /api/booking/reschedule` allowed only if `starts_at − now() > 72h`; else rejected with policy message. `cancel` never refunds (records `cancelled`, frees capacity). All transitions audited in `reservation_events`.

---

## 5. Engine pieces specific to Phase 1

- **Per-service tax + service charge:** the booking pricer reads `config.tax_bps` (ITBIS 18%) **and** `config.service_charge_bps` (Propina Legal 10%) and returns them as **two separate lines**. The store path uses `service_charge_bps=0` (take-out → no Propina). One shared money helper, per-service config.
- **Independent session capacity (18 each):** one slot row per (product, date, time); Wine Tour and Full Experience never share a counter (confirmed §1).
- **No-refund policy:** encoded in `capacity_rules.refundable=false` + the 72 h reschedule gate; surfaced in confirmation emails and the booking UI before payment.
- **Lead time / cutoff:** `lead_time_min` blocks last-minute holds.

---

## 6. Decisions — resolved vs still needed

**Resolved**
- ✅ Session cap: **18 each** (Wine Tour and Full Experience independent per session).
- ✅ Club House: **no-charge reservation** (pay by consumption on-site; no card hold).
- ✅ Tax/charge: ITBIS 18% + Propina Legal 10% as **separate lines**, dine-in only; store stays 18%.
- ✅ Policy: no refunds; reschedule only > 72 h.

**Still needed before launch**
1. **Club House** minimum purchase amount (to show in the reservation note), if any.
2. **Lunch add-on price** on Wine Tour at 14:00/16:00 (or is lunch only via Full Experience?).
3. **Operating days/hours** for the slot generator (every day? closed weekday? season window?).
4. **Full Experience** 3-course menu choices (for the per-person selector).
5. **Weddings / corporate events / buffet** — capture fields + pricing/packages + deposit % (deferred until defined).
6. WhatsApp: the dedicated number — provide when ready (Phase 4); I'll prep the adapter meanwhile.

---

### Ready to build
On your ✅ to §6.1 (shared cap) and §6.2 (Club House charge model), I'll:
1. Create the additive Neon tables + seed (above) and the slot generator.
2. Implement `/api/booking/{availability,hold,quote,confirm,cancel,reschedule}` + the holds-sweeper cron.
3. Add per-service 28% tax to pricing.
4. Build the booking UI (session picker + party size + EN/ES) and wire Stripe for the two prepaid products.
5. Extend `/admin` with a bookings + availability board.

This leaves the live site untouched until you approve the new flow on `pages.dev`.
