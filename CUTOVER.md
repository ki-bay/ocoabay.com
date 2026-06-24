# OcoaBay — Go-Live / DNS Cutover Checklist

Switching `ocoabay.com` from WordPress to this Cloudflare Pages app. Do the steps
in order. Nothing here is auto-run — the DNS change is yours to make.

Current production deploy: `https://ocoabay-clone.pages.dev`
Repo: `github.com/ki-bay/ocoabay.com` (push to `main` auto-builds; `wrangler pages deploy public` also works)

---

## 0. Pre-flight (do BEFORE touching DNS)

- [ ] **Back up WordPress** (DB + uploads) so rollback is possible.
- [ ] **Set production secrets** in Cloudflare → Pages → ocoabay-clone → Settings → Environment variables (Production). Encrypt each:
  - [ ] `DATABASE_URL` — Neon pooled connection string *(already set if checkout works in prod)*
  - [ ] `ADMIN_TOKEN` — strong random value; this locks `/admin`
  - [ ] `RESEND_API_KEY` + `EMAIL_FROM` (e.g. `OcoaBay <no-reply@ocoabay.com>`) — turns on order/reservation emails
  - [ ] `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` — turns on card capture at checkout
  - [ ] `STRIPE_WEBHOOK_SECRET` — from the Stripe webhook you create in step 1
  - [ ] `WC_KEY` / `WC_SECRET` — only if re-syncing the catalog from WooCommerce
- [ ] **Redeploy** after adding secrets so functions pick them up.

## 1. Stripe (only if taking card payments at launch)

- [ ] In Stripe Dashboard → Developers → Webhooks → Add endpoint:
      `https://ocoabay.com/api/stripe-webhook`, event `payment_intent.succeeded`.
- [ ] Copy its signing secret → set `STRIPE_WEBHOOK_SECRET` (step 0) → redeploy.
- [ ] Test with a Stripe test card on `…pages.dev/checkout/` before cutover.
      (No keys = checkout still works as "place order, we'll arrange payment.")

## 2. Attach the custom domain in Cloudflare Pages

- [ ] Pages → ocoabay-clone → Custom domains → **Set up a domain** → `ocoabay.com`.
- [ ] Add `www.ocoabay.com` too (redirects to apex).
- [ ] Cloudflare will show the DNS target (CNAME / or it manages it if the zone is on Cloudflare).

## 3. DNS

If `ocoabay.com` DNS is **already on Cloudflare**: adding the custom domain wires it
automatically — just remove the old A/CNAME records pointing at the WordPress host.

If DNS is **elsewhere** (registrar/host):
- [ ] `ocoabay.com` → CNAME/ALIAS → `ocoabay-clone.pages.dev` (or the apex A records Cloudflare shows)
- [ ] `www` → CNAME → `ocoabay-clone.pages.dev`
- [ ] Lower TTL to 300s a day beforehand so the switch propagates fast.

## 4. The moment it goes live (automatic, no code change)

- The `noindex` guard in `functions/_middleware.js` only fires on `*.pages.dev`.
  On `ocoabay.com` it stops sending `X-Robots-Tag: noindex` → **search engines may index** ✅
- Canonicals, hreflang, sitemaps and `robots.txt` already point at `https://ocoabay.com` ✅
  (1:1 mirror — they were self-referential to the real domain all along.)

## 5. Post-cutover verification

- [ ] `curl -I https://ocoabay.com/wine/` → `200`, and **no** `x-robots-tag: noindex`.
- [ ] Homepage, EN + ES menus click through (spot-check `/wine/`, `/vino/`, `/store/`, `/contacto/`).
- [ ] Language switcher round-trips (EN flag ↔ ES flag).
- [ ] Add to cart → checkout → (Stripe test card if enabled) → order shows in `/admin`.
- [ ] Submit a reservation on an experience page → shows in `/admin` → email received (if Resend on).
- [ ] Contact map shows **Bahía de Ocoa, Carretera Hatillo Palmar de Ocoa, Azua 71003**.
- [ ] Google Search Console: add `ocoabay.com`, submit `https://ocoabay.com/sitemap_index.xml`,
      request re-index of the homepage.
- [ ] Confirm SSL/TLS is active (Cloudflare issues the cert automatically; may take a few minutes).

## 6. Rollback (if needed)

- Repoint `ocoabay.com` DNS back to the WordPress host (kept from step 0).
- WordPress is untouched by this project, so it resumes immediately once DNS reverts.

---

### Notes
- **`/admin`** is `noindex` and token-gated; it's reachable at `https://ocoabay.com/admin/`.
- **Stripe / Resend are gated**: with no keys the store still takes orders into Neon and the
  reservation/contact forms still save — they just don't capture cards or send email yet.
- Catalog is a fresh start (no order/customer migration), per plan.
