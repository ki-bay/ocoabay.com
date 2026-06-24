# Clone Audit — ocoabay.com

Captured: 2026-06-24. Source: live rendered site, mirrored with `wget`.

## What was captured (1:1 static)

- **65 HTML pages** — full bilingual site (English + Spanish).
- **124 CSS**, JS, **291 images** (webp/jpg/png/svg), **19 font files** (incl. localized Barlow).
- Total deployable size: **~67 MB** in `public/`.
- Verified: homepage clone vs. live screenshot = **visually identical**.

## Fixes applied

- Internal links converted to work as a static site (`--convert-links`).
- **Self-hosted fonts localized** — 54 Barlow font URLs that pointed at the WP
  Engine origin (`ocoabay.wpenginepowered.com`) were downloaded and rewritten to
  root-relative paths so type renders offline.
- Removed crawl junk: `?p=NNN` shortlink artifacts, RSS `feed/` dirs, `xmlrpc`.

## Known limitations (need a real backend — Supabase)

These pages are **visually accurate but non-functional** as static copies:

| Area | Status | Notes |
|------|--------|-------|
| Contact / Reservation forms | Visual only | Wire to `/api/contact` (handler ready) |
| Store / Shop / Products | Visual only | WooCommerce — the real store is on a **separate subdomain `market.ocoabay.com`** (not mirrored). Rebuild on Supabase when ready. |
| Cart / Checkout / My Account | Excluded | Transactional WooCommerce pages — intentionally not mirrored. |
| Newsletter popup | Visual only | Submits nowhere until wired up. |

## External resources kept as-is (load from their CDNs)

Analytics (Google Tag Manager), social embeds (Facebook/YouTube/Instagram/
TripAdvisor/LinkedIn), jQuery CDN, WordPress emoji (`s.w.org`). These are
third-party and load at runtime exactly as on the original.

## Third-party / tracking note

Google Tag Manager and social pixels are still embedded (copied verbatim). Decide
whether to keep, replace with your own analytics, or strip for privacy before
going live.
