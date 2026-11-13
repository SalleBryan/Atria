# Business lane log

Append status notes here. Only the business lane edits this file.

## 2026-11-13 business lane, session 1 (branch `biz/usage-statement-and-baseline`, not committed or pushed)

Read the whole handoff, working rules, ADRs, audit, SRS, evidence report and pitch map first. Done:

- **B0:** ADR 0030 written, status proposed. Waits for the owner. No plan, invoice or billing code exists or was started.
- **B1:** `GET /messages/usage?month=YYYY-MM` (administrator, `message.read` at tenant scope). Counts settled message log rows by unit, kind, channel and state. Pure arithmetic in `backend/src/atria/core/usage.py`, service in `services/directory/messages.py`, route in `infra/.../api.py`, contract in `docs/openapi/atria.yaml`, ADR 0031. Counts only: no price. An administrator Usage tab on Messages shows it (added later the same day, `web/src/staff/UsageStatement.tsx`).
- **B2, F18 fixed:** the outcome chart now includes a "Still open" segment so it divides by booked visits like the exports. Exports (PDF, Excel, CSV) show "Share of booked" and "Share of closed" apart, and attendance stays attended over attended plus no-show.
- **B2, comparison:** `?before=<date>` on `GET /clinics/{id}/report` and `GET /reports` adds `comparison` (counts before, after, change; attendance in points) for an earlier period of the same granularity. Arithmetic is `core/report.py::change`. Reports has a "Compare" picker (previous day, week, month or year) that adds "was X, up Y" lines to the tiles; screenshotted at 1280x720 and 375 wide in the preview, no overflow.
- Tests added: `tests/core/test_usage.py`, usage and comparison cases in `test_delivery.py` and `test_ledger_report.py`, an F18 case in `reportExport.test.ts`.

Verified: ruff, ruff format, mypy, full backend pytest with the 85% floor, `spec/generate.py --check`, infra ruff and pytest, web typecheck and all 260 web tests.
Not verified: `cdk synth`, the Flutter job, `npm run format:check` (reports 168 files, almost all untouched; looks like CRLF from the Windows checkout, not checked against a clean clone), nothing run against the deployed app, no screenshots (no screen was changed beyond the donut gaining a segment).

For the pain lane: no field is needed from you. Queue-quality metrics (ADR 0022) are not built because `CONSULTATION_ENDED` does not exist yet.

## 2026-11-13 business lane, session 1 (later): B4

- **B4:** `/console/onboarding` ("Set up a unit", administrator only, tile on the overview). Five steps for one unit, each read from live data and never stored: unit details, visit types offered, fees on every offered type, clinicians, patients in the register. Each links to the existing screen that does it (Hospital settings, Staff accounts, Patients, which hold the importers). `web/src/staff/Onboarding.tsx`, no backend change. It fetches its own unit data on open because the console's copy is loaded once and would miss a unit added a moment ago.
- Walked through in the preview as the administrator: overview tile, unit switch, the settings link, adding a unit and seeing it at 1 of 5, at 1280x720 and 375 wide.
- **Platform rule (from the owner):** the text in a pill (`.chip`) is always centred. Added `text-align: center` to `.chip` in `patient.css`.
- Not verified: other screens that stretch a chip were not each re-screenshotted. Not in the preview: the sample units are all complete, so a to-do state needs a unit added in the session.

## 2026-11-13 business lane, session 1 (later still): comparison in the exports

- The Compare choice on Reports now also lands in the PDF (a section), the Excel workbook (a Comparison sheet) and the CSV (rows under "Compared with the earlier period"), in the page's words. `web/src/utils/reportExport.ts` now owns the comparison type and wording; `Reports.tsx` imports it.
- Observed in the preview with the download captured in the page, nothing saved to disk: the CSV rows and the Excel sheet were read back and are right; the PDF came out as a valid 112 KB file, but I did not read its page text.
- Preview quirk, not a code bug: the mock returns the earlier period as a single date.

## 2026-11-13 business lane, session 1 (queue metrics, branch `biz/queue-metrics`)

- **Correction first:** PR 23 was merged after only its first commit's backend work. The Usage tab, Compare picker, comparison exports, set up a unit checklist, pill fix and handoff updates were not in `main`. They are replayed in PR 26 (`biz/web-screens`). This branch is cut from that one, so it needs PR 26 merged first, or it will show those commits too.
- **Queue-quality measurements** in the weekly report, as the pain lane's log said, from stamps the queue already writes (no new event): `core/queue_metrics.py` (pure), `report.week_figures` and `hospital_figures` carry `queue` (null for a unit with no queue). Typical wait after arriving, typical consultation, seen within the arrival window, time past the window, doctor free while someone waited, places passed over, urgent, arrived late, and how places were taken (online or at the desk). The page has a "The general queue" card; the PDF, Excel (a Queue sheet) and CSV carry the same rows from one function, `queueRows`.
- **Limits, stated on the page and in the code:** a breach is measured against the arrival window as last told to the patient, because a window is recalculated as the session runs and the first one is not kept (`shortcut:` in `queue_metrics.py`; add an original window to the ticket to fix it, which is the pain lane's file). Medians do not add, so the hospital report leaves them as "Not available here". "Doctor free while someone waited" is a doctor's gap between two consultations overlapped with the time any patient of the unit had arrived and was waiting; it ignores the time before a doctor's first consultation.
- No figure is a price, a saving or a cause (FR-MSR-04, CX-12). A wait reads in minutes below an hour, then hours and minutes.
- Observed in the preview as the administrator: hospital report (sums, no medians) and the outpatient desk (medians), and the Excel Queue sheet read back. A unit with no queue shows no card (tested, not observed). The PDF was not read.
- For the pain lane: the first arrival window is the one thing this lane cannot measure without a field on the ticket.
