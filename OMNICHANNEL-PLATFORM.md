# OcoaBay — In-Panel Omnichannel Platform (respond.io-equivalent) + Autonomous Ops

Goal: a respond.io-style customer platform **inside the OcoaBay admin**, running **fully automated**.
The AI does the work (answers + books); the system **reports to email**. If a report flags an error,
a human verifies and fixes it; if no error is flagged, the automation simply **keeps running**.

## Operating model — "supervised autonomy"
```
Customer (WhatsApp / Instagram / web / email)
   → AI agent answers + books (tools: availability, pricing, booking link, lookup, escalate)
   → everything logged (conversations, messages, agent_runs, reservations, payments)
   → periodic EMAIL REPORT: what was handled + anomalies flagged
        • no anomalies  → automation continues untouched
        • anomalies     → human opens the in-panel inbox, verifies, fixes that case only
```

## What maps to respond.io (and where each stands)
| respond.io feature | In OcoaBay panel | Status |
|---|---|---|
| Omnichannel **inbox** (WA/IG/web/email) | Admin → Conversations/Inbox | ✅ threads + handoff; **+ reply-into-channel (Phase 1)** |
| **AI agent** auto-reply + booking | Anthropic agent + tools | ✅ built (gated on key) |
| **Contacts / CRM** | customers + bookings + conversations + tags/notes | ◻ Phase 2 |
| **Workflows / automation** | crons + agent + rules | ◻ rules engine Phase 3 (visual builder likely stays in respond.io) |
| **Broadcasts** | segment → WhatsApp/email blast | ◻ Phase 3 |
| **Analytics** | agent_runs + booking/payment metrics | ◻ Phase 2 dashboard |
| **WhatsApp API onboarding** | (Meta direct, or via a BSP) | ⚠ you provide creds; respond.io/360dialog can simplify |
| **Autonomous ops report** | daily email digest + anomaly flags | ✅ **Phase 1 (this build)** |

## Anomalies the report flags (the "errors" humans verify)
- Conversations **escalated** to human / low-confidence AI answers
- Bookings stuck in **pending_payment** (abandoned) or with **balance due** today
- **Payment** failures / Stripe webhook errors
- Channel **send failures** (WhatsApp/IG/email)
- Agent **tool errors** or API failures
- Unusual volume (spikes/drops)

If the report is clean → the automation needs no human and continues. If it lists anomalies → a human
opens the inbox, checks those specific items, and fixes only what's verified as a real problem.

## Phased build
1. **Now:** autonomous **ops report** email (digest + anomalies) + **reply-into-channel** from the admin inbox (so a human can take over any flagged chat). Scheduler runs the report daily.
2. **Next:** Contacts/CRM view (customer 360: bookings, payments, conversations, tags/notes) + analytics dashboard.
3. **Later:** rules/automation engine (trigger → condition → action), broadcasts. (A full visual workflow builder may stay in respond.io.)

## Honest note
A 1:1 respond.io clone is a large product; rebuilding *everything* (visual flow builder, full mobile app,
massive broadcast infra) is rarely worth it. The high-value 80% — autonomous AI handling, an in-panel
inbox a human can jump into, contacts, and email reporting — is what this plan builds. If you later want
heavy human-agent teamwork or one-click WhatsApp onboarding, respond.io can run *alongside* this, calling
our booking APIs.
