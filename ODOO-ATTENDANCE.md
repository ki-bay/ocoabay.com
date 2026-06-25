# OcoaBay — Biometric Attendance → Odoo (HR / Payroll)

Direct device-to-cloud attendance: a **WiFi/LAN biometric terminal pushes punches to Cloudflare**,
which records + dedupes them and writes `hr.attendance` into **Odoo.sh**. **No on-site PC / Raspberry Pi.**

```
[ZKTeco Push terminal @ gate] --HTTPS (ADMS)--> [Cloudflare /iclock/cdata] --JSON-RPC--> [Odoo.sh]
   fingerprint/face → punch          dedup in Neon (device_punches)        hr.attendance (in/out)
                                      replay if Odoo offline                hr.contract → hr.payslip
```

## 1. What to buy (insist on these specs)
- **ZKTeco** terminal with **"Push SDK / ADMS / cloud server"** support over **HTTPS**, plus **WiFi or Ethernet**.
  - Recommended: **ZKTeco SpeedFace-V5L (WiFi)** — face + fingerprint + card (contactless, fast at a gate).
  - Budget / finger-only: **ZKTeco F18 / iClock** "Push" variants.
  - Outdoor gate → weatherproof variant or mount under cover; prefer **PoE Ethernet** if available.
- Confirm with the vendor: *"supports ADMS push to a custom HTTPS server URL, and reports device serial (SN)."*

## 2. Configure the device (once it arrives)
On the terminal: **Comm → Cloud Server / ADMS**:
- **Server Address:** `ocoabay.com` (or the pages.dev host) · **Port:** `443` · **HTTPS:** on · **Path:** `/iclock/`
- It will call `GET /iclock/cdata?SN=…` (handshake) then `POST …&table=ATTLOG` (punches) automatically.
- Note the device **Serial Number** → add it to `DEVICE_SERIALS`.
- Enrol each employee; the device **user-id** must match the employee in Odoo (see §4).

## 3. Cloudflare side — already built & tested
| Endpoint / job | Purpose |
|---|---|
| `GET /iclock/cdata` | ADMS handshake (enables realtime push) |
| `POST /iclock/cdata?table=ATTLOG` | receives punches → dedups in `device_punches` (Neon) → Odoo `hr.attendance` |
| `GET/POST /iclock/getrequest` | command poll (acks "OK") |
| `POST /api/cron/attendance-replay` | retries punches recorded before Odoo was wired / failed pushes (Bearer ADMIN_TOKEN) |
| `db/sim-attendance.mjs` | **simulator** — tested the whole pipe with no hardware (handshake, upload, dedup all ✅) |

**Idempotent:** punches are unique on `(SN, device_user_id, punched_at)`, so device retries never double-count.
**Resilient:** if Odoo is unreachable/unset, punches are stored and replayed later by the cron.
**Attendance logic:** first punch of a pair = `check_in`, next = `check_out` (toggle), timestamps converted DR→UTC.

## 4. Odoo.sh setup (you)
1. **Edition:** **Enterprise** (the official **Payroll** app is Enterprise-only; Community has no payroll).
2. Install apps: **Employees, Attendances, Contracts, Payroll, Accounting**.
3. Create each employee; put the **device user-id** in the field named by `ODOO_EMP_MATCH_FIELD` (default `barcode`).
4. **Settings → Account Security → API Keys** → generate a key → set the env vars below.

## 5. Environment variables (Cloudflare + .dev.vars)
```
ODOO_URL=https://yourco.odoo.com
ODOO_DB=yourdb
ODOO_USER=you@yourco.com
ODOO_API_KEY=…                 # Odoo API key
ODOO_EMP_MATCH_FIELD=barcode   # hr.employee field holding the device user-id
DEVICE_SERIALS=SN123,SN456     # allowed terminal serial numbers
ADMIN_TOKEN=…                  # protects the replay cron
```
Until these are set, the receiver still records punches (and replays once configured) — same gated pattern as Stripe/Resend.

## 6. Payroll (Dominican Republic) — Phase next
There's **no official DR payroll localization**, so salary rules are **custom** in Odoo Payroll:
- **TSS** (employee ≈ 5.91% = SFS 3.04% + AFP 2.87%; plus employer share)
- **ISR** (income tax) by annual brackets (exempt ≈ RD$416k/yr)
- **Regalía pascual** (13th-month, by Dec 20), overtime, vacaciones, cesantía/preaviso per Código de Trabajo
- Worked hours come from `hr.attendance` → feed the payslip.

## 7. Privacy / compliance
Fingerprint/face **templates stay on the device**; only `device_user_id + timestamp` reach the cloud/Odoo
(good practice under DR Ley 172-13). Restrict by `DEVICE_SERIALS`; serve only over HTTPS.

## 8. Test now (no hardware)
```
node db/sim-attendance.mjs            # simulates a terminal against production
```
Verified: handshake 200 · `ATTLOG → OK: 3` · re-upload `OK: 0` (dedup) · punches stored for replay.

---
*Note: the receiver targets the standard ZKTeco PUSH/ADMS protocol; the exact ATTLOG field layout can vary
slightly by firmware/model — once you pick the model we confirm the payload format against a real device.*
