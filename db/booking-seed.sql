-- OcoaBay Phase 1 — service seed (idempotent via on conflict).
-- tax_bps=1800 (ITBIS 18%); service_charge_bps=1000 (Propina Legal 10%, dine-in).
-- operating_days: 4=Thu,5=Fri,6=Sat,0=Sun (JS getUTCDay()).

insert into services (slug, type, name_en, name_es, pricing_model, base_price_cents, deposit_bps, capacity_rules, config) values
('wine-tour', 'tour', 'Wine Tour Experience', 'Experiencia Tour de Vinos', 'per_guest', 6500, 0,
  '{"session_cap":18,"lead_time_min":120,"reschedule_cutoff_h":72,"refundable":false}',
  '{"tax_bps":1800,"service_charge_bps":1000,"sessions":["10:30","14:00","16:00"],"operating_days":[4,5,6,0],"payment":"full","duration_min":90,"uses_clubhouse":true}'),
('full-experience', 'experience', 'OcoaBay Full Experience', 'Experiencia Completa OcoaBay', 'per_guest', 14500, 0,
  '{"session_cap":18,"lead_time_min":120,"reschedule_cutoff_h":72,"refundable":false}',
  '{"tax_bps":1800,"service_charge_bps":1000,"sessions":["14:00","16:00"],"operating_days":[4,5,6,0],"includes_clubhouse":true,"menu_in_email":true,"payment":"full","duration_min":90,"uses_clubhouse":true}'),
('club-house', 'restaurant', 'OcoaBay Club House', 'OcoaBay Club House', 'quote', 0, 0,
  '{"daily_cap":100,"reschedule_cutoff_h":72,"refundable":false}',
  '{"tax_bps":1800,"service_charge_bps":1000,"operating_days":[4,5,6,0],"payment":"none","min_purchase":false,"hours":"11:00-18:30"}')
on conflict (slug) do update set
  type=excluded.type, name_en=excluded.name_en, name_es=excluded.name_es,
  pricing_model=excluded.pricing_model, base_price_cents=excluded.base_price_cents,
  deposit_bps=excluded.deposit_bps, capacity_rules=excluded.capacity_rules, config=excluded.config;
