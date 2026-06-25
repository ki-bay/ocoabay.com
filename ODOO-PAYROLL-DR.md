# OcoaBay — Dominican Republic Payroll Rules (Odoo design)

There is **no official DR payroll localization** in Odoo, so the salary structure is **custom salary rules**
on top of Odoo Enterprise Payroll. This is the design to implement once Odoo.sh is provisioned (Track B).
Worked hours come from `hr.attendance` (the biometric feed) → drive `hr.payslip`.

> ⚠️ Rates/brackets change by law and SIRLA/DGII/TSS notices. Treat the numbers below as the model to
> **confirm with the client's accountant** before payroll runs live. Build the rates as **Odoo config
> (Rule Parameters)**, not hard-coded, so they're updatable without code.

---

## 1. Pay components (salary structure "OcoaBay RD")

Order matters — each rule references the previous bases.

| Seq | Code | Rule | Formula (concept) |
|---|---|---|---|
| 10 | `BASIC` | Base salary | Contract monthly wage (or hourly × attendance hours) |
| 20 | `OT` | Overtime | Hours > legal (44h/week) × rate (35% extra ≤68h; **100%** beyond / night / holiday) |
| 30 | `GROSS` | Gross taxable | `BASIC + OT + other taxable allowances` |
| 40 | `SFS` | Health (TSS) — employee | **3.04%** of `min(GROSS, SFS_CAP)` |
| 50 | `AFP` | Pension (TSS) — employee | **2.87%** of `min(GROSS, AFP_CAP)` |
| 60 | `TSS_EE` | Employee TSS total | `SFS + AFP` (≈ **5.91%**) |
| 70 | `ISR_BASE` | Taxable for income tax | `GROSS − TSS_EE` (TSS is deductible before ISR) |
| 80 | `ISR` | Income tax (retención) | Annual bracket table ÷ 12 (see §2) |
| 90 | `NET` | Net pay | `GROSS − TSS_EE − ISR − other deductions` |

**Employer cost (informational, not deducted from employee):**
`SFS_ER` 7.09% · `AFP_ER` 7.10% · `SRL` (risk) ~1.10–1.30% · **INFOTEP** 1% of payroll.
Add as employer lines / `EMP_COST` for true labor-cost reporting.

---

## 2. ISR (income tax) — annual brackets, retención mensual

Apply on **annualized** `ISR_BASE`, then divide the year tax by 12. Bracket thresholds (RD$/year) — **confirm current DGII values**:

| Annual taxable (RD$) | Tax |
|---|---|
| 0 – 416,220.00 | Exempt (0%) |
| 416,220.01 – 624,329.00 | 15% of excess over 416,220 |
| 624,329.01 – 867,123.00 | 31,216 + 20% of excess over 624,329 |
| 867,123.01 + | 79,776 + 25% of excess over 867,123 |

Implement as a **Rule Parameter** (table of `[threshold, base_tax, marginal_rate]`) so it updates without code.

---

## 3. Caps & parameters (Rule Parameters in Odoo)
- `SFS_CAP` = 10 × national minimum wage (cap on health base) — **confirm**.
- `AFP_CAP` = 20 × national minimum wage (cap on pension base) — **confirm**.
- `OT_RATE_1` = 0.35 (overtime up to 68h/wk), `OT_RATE_2` = 1.00 (beyond / nights 9pm–7am / 100%-holidays).
- `WEEK_LEGAL_HOURS` = 44.
- Minimum wage by sector/company size (RD$) — **confirm current**.

---

## 4. Statutory periodic items
- **Regalía pascual (13th month):** = total ordinary salary earned in the year ÷ 12; pay by **Dec 20**; **not** subject to ISR up to the legal limit. Model as a December run / separate input.
- **Bonificación** (profit share, if applicable): per company policy / law.
- **Vacaciones:** 14 days after 1 yr (18 after 5 yrs); vacation pay.
- **Cesantía / preaviso** (severance): on termination, per years of service — handled at off-boarding, not monthly.

---

## 5. Attendance → payroll link
- `hr.attendance` (from the biometric Push feed) gives worked hours per period.
- Hourly/!fixed contracts: `BASIC = hourly_rate × worked_hours`; salaried: hours validate presence + compute `OT`.
- Configure **Working Schedule** (44h/wk) so Odoo derives overtime vs regular from attendance.

---

## 6. Build steps in Odoo (once B1–B2 done)
1. Create **Salary Structure** "OcoaBay RD" + the rules in §1 (Python-coded rules referencing Rule Parameters).
2. Add **Rule Parameters**: TSS rates + caps, ISR bracket table, OT rates, legal hours, minimum wage.
3. Configure **Working Schedules**, employee **Contracts** (wage, schedule, structure).
4. Test payslips against a known manual calc for 2–3 employees (incl. an overtime case + an ISR-paying case).
5. Set the **December regalía** run.
6. Connect attendance: confirm worked-hours flow from `hr.attendance` into the payslip worked-days lines.

---

## 7. What I can prepare now (no Odoo access)
- The **Python salary-rule code** for each component (ready to paste into Odoo's rule editor).
- The **Rule-Parameter seed values** (as a checklist for the accountant to confirm).
- A **payslip test workbook** (expected numbers for sample salaries) to validate the config.

*Once Odoo.sh + API key exist, I wire it and run the validation payslips.*

---

## 9. Ready-to-paste Odoo salary-rule code (Python)

Create a Salary Structure "OcoaBay RD" and add these rules (Amount type = **Python Code**).
Categories: **BASIC, ALW** (allowances), **DED** (deductions), **GROSS, NET, COMP** (employer cost).
Values come from **Rule Parameters** (§10) so the accountant can update rates without touching code.
Sign convention: deductions are **negative**.

```python
# --- BASIC  (code: BASIC, category: BASIC) ---
result = contract.wage

# --- OT  Overtime (code: OT, category: ALW)  [payslip input: OT_HOURS] ---
legal  = payslip.rule_parameter('dr_week_legal_hours')          # 44
hourly = contract.wage / (legal * 4.333)
ot_h   = inputs.OT_HOURS.amount if 'OT_HOURS' in inputs else 0.0
result = ot_h * hourly * (1 + payslip.rule_parameter('dr_ot_rate1'))   # +35%

# --- GROSS  (code: GROSS, category: GROSS) ---
result = categories.BASIC + categories.ALW

# --- SFS  Health, employee (code: SFS, category: DED) ---
cap   = payslip.rule_parameter('dr_sfs_cap')
result = - min(categories.GROSS, cap) * payslip.rule_parameter('dr_sfs_rate')   # 3.04%

# --- AFP  Pension, employee (code: AFP, category: DED) ---
cap   = payslip.rule_parameter('dr_afp_cap')
result = - min(categories.GROSS, cap) * payslip.rule_parameter('dr_afp_rate')   # 2.87%

# --- ISR  Income tax retención (code: ISR, category: DED) ---
# taxable = GROSS - employee TSS (SFS, AFP are negative)
annual = (categories.GROSS + SFS + AFP) * 12.0
tax = 0.0
for floor, base, rate in reversed(payslip.rule_parameter('dr_isr_brackets')):
    if annual > floor:
        tax = base + (annual - floor) * rate
        break
result = - tax / 12.0

# --- NET  (code: NET, category: NET) ---
result = categories.GROSS + categories.DED

# --- Employer cost lines (category: COMP, not deducted from employee) ---
# SFS_ER:   result = min(categories.GROSS, payslip.rule_parameter('dr_sfs_cap')) * payslip.rule_parameter('dr_sfs_er_rate')   # 7.09%
# AFP_ER:   result = min(categories.GROSS, payslip.rule_parameter('dr_afp_cap')) * payslip.rule_parameter('dr_afp_er_rate')   # 7.10%
# SRL_ER:   result = min(categories.GROSS, payslip.rule_parameter('dr_afp_cap')) * payslip.rule_parameter('dr_srl_er_rate')   # ~1.10%
# INFOTEP:  result = categories.GROSS * payslip.rule_parameter('dr_infotep_rate')                                            # 1.00%
```

```python
# --- REGALIA  13th month (separate December run, code: REGALIA, category: ALW, ISR-exempt to legal limit) ---
# Sum of ordinary salary earned Jan–Nov / 12. Implement via a December input or a dedicated structure.
result = inputs.YTD_ORDINARY.amount / 12.0 if 'YTD_ORDINARY' in inputs else 0.0
```

## 10. Rule Parameters to create (seed — **confirm with accountant/TSS/DGII**)
| Code | Value | Meaning |
|---|---|---|
| `dr_week_legal_hours` | 44 | legal weekly hours |
| `dr_ot_rate1` | 0.35 | overtime premium (≤68h/wk) |
| `dr_sfs_rate` / `dr_afp_rate` | 0.0304 / 0.0287 | employee health / pension |
| `dr_sfs_er_rate` / `dr_afp_er_rate` | 0.0709 / 0.0710 | employer health / pension |
| `dr_srl_er_rate` / `dr_infotep_rate` | 0.0110 / 0.0100 | risk / INFOTEP |
| `dr_sfs_cap` / `dr_afp_cap` | (10× / 20× min wage) | TSS contribution caps — **confirm** |
| `dr_isr_brackets` | `[[0,0,0],[416220,0,0.15],[624329,31216.35,0.20],[867123,79775.15,0.25]]` | annual ISR table — **confirm DGII** |

## 11. Validation workbook (test before going live)
Run payslips for these and match to a manual calc:
1. Salary RD$30,000/mo, no OT → ISR exempt; check TSS = ~5.91%.
2. Salary RD$80,000/mo → pays ISR (verify bracket math); TSS caps if applicable.
3. Salary RD$25,000 + 10h overtime → verify OT line + net.
4. December run → regalía line, ISR-exempt.

---

## 12. Attendance-driven pay (salary computed from scanned hours)

The biometric scans become `hr.attendance` (check_in/check_out). The payslip computes pay from those hours.
Choose per employee/contract:

**A) Hourly employees — pay = rate × hours actually worked.** Replace the BASIC rule with:
```python
# --- BASIC (hourly, attendance-driven). Reads real scanned hours in the payslip period. ---
d_from, d_to = payslip.date_from, payslip.date_to
atts = employee.attendance_ids.filtered(
    lambda a: a.check_out and d_from <= a.check_in.date() <= d_to)
hours = sum(atts.mapped('worked_hours'))
result = hours * (contract.hourly_wage or (contract.wage / (payslip.rule_parameter('dr_week_legal_hours') * 4.333)))
```
→ Fewer hours scanned ⇒ lower salary, automatically. Overtime = hours beyond the weekly legal limit at the OT premium.

**B) Salaried employees — fixed wage + attendance for OT / absences.** Keep `BASIC = contract.wage`, and add:
```python
# --- ABSENCE deduction (salaried): unworked vs scheduled hours ---
scheduled = contract.resource_calendar_id.hours_per_day * worked_days.WORK100.number_of_days  # planned
d_from, d_to = payslip.date_from, payslip.date_to
actual = sum(employee.attendance_ids.filtered(lambda a: a.check_out and d_from <= a.check_in.date() <= d_to).mapped('worked_hours'))
missing = max(0.0, scheduled - actual)
hourly = contract.wage / (payslip.rule_parameter('dr_week_legal_hours') * 4.333)
result = - missing * hourly      # category DED
```

**Recommended Odoo setup either way:** Employees → Configuration → enable attendance-based work entries (or use the rules above, which read `hr.attendance` directly and don't depend on work-entry config). Set each employee's **Working Schedule** (44h/wk) so overtime is well-defined.

**End-to-end:** scan out at the gate → within minutes the punch is in Odoo `hr.attendance` → at payroll run, the rule sums the period's hours → salary reflects exactly the time worked.
