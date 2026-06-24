# OcoaBay — Static Clone (Cloudflare Pages + Supabase)

A pixel-perfect static clone of **ocoabay.com**, served from Cloudflare Pages,
with a Supabase-backed API layer for forms (and, later, a real store).

## Structure

```
public/            <- the deployable site (mirrored HTML/CSS/JS/images), served by Cloudflare Pages
functions/         <- Cloudflare Pages Functions (serverless API at /api/*)
  api/contact.js   <- contact/reservation form -> Supabase
supabase/
  schema.sql       <- database schema (run in Supabase SQL editor)
.env.example       <- environment variables
docs/              <- notes, audit, page inventory
```

## Local development

```bash
npm install
npm run dev      # Cloudflare Pages dev server (static + functions) at http://localhost:8788
# or, static only:
npm run serve    # http://localhost:8080
```

## Deploy to Cloudflare Pages

1. Create a Supabase project, run `supabase/schema.sql` in the SQL editor.
2. Create a Cloudflare Pages project (connect this repo, or use direct upload).
   - Build command: *(none — static)*
   - Output directory: `public`
3. In Pages → Settings → Environment variables, add the values from `.env.example`.
4. `npm run deploy` (or push to the connected git branch).

## Fidelity notes

- All **marketing pages** (English + Spanish) are exact static copies.
- **WooCommerce** pages (shop/cart/checkout/account/reservation) are captured
  **visually only** — they do not process orders/logins until rebuilt on
  Supabase. See `docs/audit.md`.
