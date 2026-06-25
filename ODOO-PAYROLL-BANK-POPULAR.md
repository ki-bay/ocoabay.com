# Payroll Disbursement — Banco Popular (Host-to-Host) for OcoaBay

Goal: each month, scanned hours → Odoo payslips (net salary, after TSS/ISR) → **automatically** paid
to each employee's account via **Banco Popular Host-to-Host (H2H)**. No manual upload.

```
Gate scans → hr.attendance → Odoo payslip (NET) → [approval] → Banco Popular nómina file
   → encrypted SFTP (H2H) to Popular → ACH/LBTR disbursement → ack file → mark payslip Paid
```

## Architecture (where each piece runs)
- **Odoo.sh (Python custom module)** does the H2H: generates Popular's payroll file, **PGP-encrypts**, **SFTPs** it to Popular, then reads the **acknowledgment** file and marks payslips paid. (Odoo.sh runs Python with `paramiko`/`pysftp` — the right place for SFTP; Cloudflare Workers can't do SSH/SFTP.)
- **Dual approval gate** before any file is sent (a person approves the batch) — standard for payroll, and usually required by the bank.

## ⏱ Reality check
Banco Popular H2H is a **bank onboarding project (typically a few weeks)**: a service agreement +
technical setup (SFTP keys, PGP, test files) + a test/certification cycle before going live. The exact
**file layout and connection details come only from Popular** — I build the generator + SFTP pipeline now
and lock the field format the moment they hand over the spec.

---

## ✅ What to request from Banco Popular (send this to your business/cash-management rep)

> **Asunto: Activación de Pago de Nómina y Conectividad Host-to-Host (H2H)**
>
> Somos cliente empresarial y queremos automatizar el pago de nómina desde nuestro sistema (Odoo).
> Favor proporcionarnos:
> 1. Activación del servicio **"Pago de Nómina" / pagos masivos ACH** en nuestra cuenta empresarial.
> 2. Activación de **Conectividad Host-to-Host (H2H) por SFTP** para envío automático de archivos (¿o disponen de **API** de pagos?).
> 3. **Diseño/estructura del archivo de nómina** (layout): tipos de registro (header/detalle/trailer), y por empleado: tipo y número de cuenta, cédula/RNC, nombre, monto, referencia. Formato (TXT ancho fijo o CSV) y codificación.
> 4. **Datos técnicos H2H:** host y puerto SFTP, método de credenciales (llaves SSH), requerimiento de **cifrado PGP** (llave pública del banco), convención de **nombres de archivo**, y formato del **archivo de acuse/respuesta (ACK)**.
> 5. **Ambiente de pruebas (test/UAT)** y proceso de **certificación** antes de producción.
> 6. **Horarios de corte**, tiempos de acreditación (Popular-a-Popular vs interbancario ACH/LBTR), **límites** y **comisiones** por transacción.
> 7. Requisito de **validación de cuentas** de beneficiarios (prenotificación) y reglas de **doble aprobación**.

## What I need from you (to build it)
- The **file layout** + **H2H technical pack** from Popular (items 3–4 above).
- Each employee's **bank account number + type + cédula** → stored on their Odoo employee/contact record.
- The bank's **PGP public key** and **SFTP credentials** (kept as Odoo.sh secrets, never in chat).

## What I build now (doesn't need the spec yet)
1. **Employee bank fields** in Odoo (account #, type, cédula) + validation.
2. **Payslip → batch** flow with a **dual-approval** step (draft → approved → sent → paid).
3. The **file generator scaffold** (header/detail/trailer, totals, references) — field positions filled once Popular's layout arrives.
4. The **SFTP+PGP submission** job + **ACK processing** (mark paid / flag rejects) — endpoints/keys plugged in at onboarding.
5. The matching **TSS (SUIR)** and **DGII (IR-3/IR-17)** file exports, so all three monthly outflows are covered.

## Security & controls
- Credentials/keys in **Odoo.sh secrets**; files **PGP-encrypted** in transit; SFTP over SSH keys.
- **Dual approval** mandatory before send; full audit trail (who approved, when, file hash, ack).
- Account **prenote/validation** before first live run.

---
### Next step
Send Popular the request above (item-by-item). The single most important thing to get back is the
**file layout (#3)** and the **H2H pack (#4)** — with those I finalize the generator and we run a test
file in Popular's UAT before the first live payroll.
