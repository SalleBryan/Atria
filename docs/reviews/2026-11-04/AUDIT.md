# Atria product, workflow, and visual audit

Reviewed on 4 November 2026, Africa/Douala.

Atria has a coherent purpose and a substantial working interface. Its strongest decisions are the separation of general queues from specialist appointments, patient choice after disruption, clinical-context privacy, and a fee ledger that does not imply online payment. The next improvement should be operational reliability and clarity. Several screens look finished while their recovery paths, state-dependent instructions, or underlying preview behavior are incomplete.

This is an extensive hands-on review, not certification that every button, state combination, browser, or backend scenario has passed. The coverage ledger below distinguishes completed browser workflows, inspected interfaces, source findings, and blocked checks. In particular, a synthetic preview cannot establish production authorization, real notification delivery, concurrent booking correctness, or deployed authentication behavior.

## What the project is targeting

Atria serves the Regional Hospital Buea, with Cameroon-specific currency, phone defaults, and hospital time. It supports five roles:

| Role | Intended work |
| --- | --- |
| Patient | Find appropriate care, join a general consultation queue, book a specialist, request a procedure, manage visits and personal details. |
| Receptionist | Register patients, book on their behalf, record arrivals and no-shows, run queues, inspect failed reminders. Clinical intake answers remain private. |
| Clinician | Work their own calendar, see their assigned patients' intake, conduct visits, set hours and time off; general practitioners also work from a queue. |
| Unit manager | Coordinate the unit's schedule and staffing, inspect reporting and audited changes, handle disruptions. |
| Tenant administrator | Manage accounts, units, appointment types, fee bands and institution policy, with oversight across units. The administrative role does not grant clinical-context access. |

The three care flows must retain their differences:

- General consultation: a place in a published session and an arrival window. A doctor is assigned at check-in; a named doctor at an exact minute should not be promised.
- Specialist consultation: a clinician, appointment type, available start, duration and turnaround. The booking is held only after successful confirmation.
- Procedure: an untimed request, then staff assessment of duration and placement, then patient confirmation.

The repository includes Python specifications and Lambda services, AWS CDK infrastructure, a React web client, and a Flutter client. This audit exercised the React client in Chrome and inspected relevant specifications and backend behavior. It did not launch the Flutter application or deploy infrastructure. The role matrix, lifecycles, API implementation, ADRs, constraints, generated hospital data and relevant client components were used to interpret the screens.

## Environment and evidence

- Local Vite development server: `http://127.0.0.1:5173`.
- Preview entry: `/__preview`; mock API data and mutations are in memory and reset on reload.
- All eleven supplied preview personas were opened: `patient`, `receptionist`, `clinician`, `manager`, `admin`, `opd`, `gp`, `surgeon`, `admin-new`, `patient-google`, and `patient-deleted`.
- Public landing, patient sign-in, registration, password recovery, staff sign-in and staff recovery were inspected separately from the preview.
- Desktop browser viewport was approximately 1232 × 599. Additional responsive checks used 768 × 1024 and 390 × 844. Temporary overrides were reset.
- Changes through the preview used synthetic records. No production records were changed; no real emails, SMS messages or calendar events were sent. External map/calendar links were inspected, not verified through third-party account completion.
- Evidence images are in [evidence/](evidence/). They are screenshots of synthetic preview data.
- No application source fixes were made. Existing changes in `.gitignore`, `web/package.json`, and `web/pnpm-lock.yaml` were left in place.

## Highest-priority application findings

Priority P1 means resolve before relying on the affected workflow in a pilot. P2 means a material usability, completeness, or resilience improvement. P3 means a smaller consistency issue. These priorities concern the affected workflow, not a claim that the entire application is unusable.

### F01 · P1 · Dropdown options appear behind modal sheets

**Verified in browser and source.** Administrator → Staff accounts → Create staff account → Unit. The listbox opens but is obscured by the account sheet. Clicking Medical Unit does not select it. Read-only DOM hit testing at the option's center returned the overlying `.sheet`. Selecting the option with the keyboard worked, and a synthetic receptionist account was then created successfully.

The shared picker portals into `.menu-layer`, whose `z-index` is 80. Modal `.scrim` uses `z-index: 1000`. The same shared picker is used by several modal workflows, so this deserves a shared-component fix and verification across account creation, procedure placement, time off, fee/type editing, country selection, and intake-form controls. Only the staff Unit picker was specifically reproduced as blocked; the broader list is the regression scope.

**Improve:** define one overlay hierarchy or use a top-layer popover/dialog strategy; mount a picker in its owning dialog when appropriate. Preserve keyboard access, focus restoration and dismissal. Check the result with real pointer hit testing at all three layouts.

Sources: `web/src/components/Pickers.tsx`, `web/src/styles/filters.css:83`, `web/src/styles/visits.css:365`.

![Staff unit picker hidden behind the account sheet](evidence/staff-unit-picker-blocked.jpg)

### F02 · P1 · Unit deletion promises account restoration that does not exist

**Verified in browser and source; deletion was not submitted.** Administrator → Settings → Units → Delete Medical Unit. The dialog says that nothing is erased for 30 days and the account can be restored exactly as it was. Its safe action is also labelled “Keep the account,” although the subject is a unit.

The unit screen reuses `DeleteAccountDialog`, which hardcodes the account recovery promise. The backend's `Settings.delete_clinic` checks for a session partition and calls repository deletion; it does not implement the account grace/restore lifecycle. It also does not visibly check assigned staff or specialist appointments in that method, even though the dialog says assigned staff must be reassigned first. This dependency concern is a source finding, not a destructive browser reproduction.

**Improve:** use a unit-specific confirmation with accurate consequences. Prefer archiving a unit that has historical references. If permanent deletion is retained, check staff, booked visits, sessions and type assignments on the server, and present the blocking dependencies before confirmation. Do not promise recovery unless it exists.

Sources: `web/src/staff/Settings.tsx:544`, `web/src/components/DeleteAccountDialog.tsx`, `backend/src/atria/data/settings.py:84`, `backend/src/atria/services/admin/settings.py:229`.

![Unit deletion incorrectly promises account recovery](evidence/unit-delete-false-recovery-promise.jpg)

### F03 · P1 · Cancelled queue tickets still instruct the patient to arrive

**Verified in browser and source.** Patient → Find care → See a doctor today → take an afternoon place → Give up my place → Cancel visit. The resulting screen says CANCELLED and confirms that the place was released, but still shows “ARRIVE FROM / UNTIL” and “Come to the … desk between … A doctor is assigned when you check in.” The cancelled item in the visit list also retains “arrive …” copy.

**Improve:** drive the entire ticket detail and list subtitle from lifecycle state. Cancelled/withdrawn tickets should explicitly say the patient no longer has a place and need not attend for that booking, with a rebooking action. Completed tickets should show attendance history. Only active tickets should show arrival instructions or promises of queue updates.

Source: `web/src/patient/QueueVisit.tsx:68` and `:91`, plus the queue item rendering in `Visits.tsx`.

![Cancelled queue ticket still tells the patient to come](evidence/cancelled-queue-still-says-arrive.jpg)

### F04 · P1 · Required terms and privacy notice cannot be opened

**Verified in browser and source.** Both patient registration and the incomplete Google-profile screen require “I agree to the Atria terms and privacy notice.” These words are plain text, with no document links or review action. The public landing footer also does not provide those documents.

**Improve:** make both documents accessible before agreement and from the footer/account area. Keep the form intact when opening them. Record which published version was accepted. This finding concerns informed product use; it is not a legal compliance determination.

Sources: `web/src/pages/CreateAccount.tsx:174`, `web/src/pages/CompleteProfile.tsx:96`.

### F05 · P1 · Suspended staff have no ordinary reactivation path

**Verified in browser and source.** A synthetic staff account was created, suspended, and inspected again. Its menu disables allowance, password reissue, role change and suspension. Delete remains, but Reactivate/Restore access is absent. The existing seeded suspended account behaves consistently with that design.

The backend suspension endpoint sets SUSPENDED. The existing restoration code is specifically for DELETION_PENDING and rejects a merely suspended account as not deleted. Deletion followed by restoration is not an appropriate recovery path and can restore the previous suspended status anyway.

**Improve:** provide an explicit, audited reactivation operation with a reason and clear resulting status. Test invited, active, suspended and deletion-pending accounts as separate states. Explain what happens to existing appointments when a clinician loses access.

Sources: `web/src/staff/StaffAccounts.tsx:539`, `:552`, `:579`; `backend/src/atria/services/identity/staff.py:372`; `backend/src/atria/services/identity/deletion.py:222`.

![Suspended account actions have no reactivation option](evidence/suspended-account-no-reactivate.jpg)

### F06 · P1 · Staff cannot size an individual procedure in the placement dialog

**Verified in browser and source.** Surgeon → Requests → Place. The screen promises “Size and place,” but exposes only clinician, day and time. The request was successfully placed, but no per-request duration was selected or reviewed.

The client submits `durationUnits: type?.durationUnits`; the backend explicitly supports a request-specific duration of 1–48 grid units. A type's default is useful, but different procedures can require different occupancy. This is a mismatch with ADR 0005's staff-sizing decision.

**Improve:** add a duration control before slot selection, show end time and turnaround, and refresh valid openings whenever duration changes. Make the final offer summary include clinician, duration, start/end, unit and fee basis. Verify server-side locking across the full selected occupancy.

Sources: `docs/adr/0005-procedures-are-staff-sized.md`, `web/src/staff/Requests.tsx:150`, `backend/src/atria/services/booking/requests.py:150`.

### F07 · P2 · Staff sign-in and recovery do not describe phone-only accounts

**Verified in browser and source.** Account creation explicitly allows no work email and supplies the mobile number as the sign-in name. The staff sign-in field is labelled “Work email,” uses an email input, and shows an email placeholder. Its form uses `noValidate`, so this review does not claim the browser necessarily rejects a phone number. The primary issue is misleading guidance and keyboard/input semantics.

Staff recovery requires an email and says an emailed code is the only route back. An administrator can issue a new temporary password, but that alternative is absent from the recovery screen.

**Improve:** use “Sign-in name: email or mobile number.” Explain international phone format. Give email recovery to accounts that have email, and clearly describe administrator-assisted recovery for the others. Link directly between patient and staff sign-in screens instead of only referring to the other screen in prose.

Sources: `web/src/pages/StaffSignIn.tsx`, `web/src/pages/ResetPassword.tsx`, `web/src/staff/StaffAccounts.tsx`.

### F08 · P2 · Clinician reporting permission has no usable web destination

**Verified through navigation and source.** The permission matrix grants `report.read` with own scope to clinicians. Their sidebar omits Reports, and `Reports.tsx` redirects every role except tenant administrator and unit manager to the console. This is not just a hidden navigation item: the existing report screen excludes the role.

**Improve:** either implement an own-scope clinician report or explicitly remove/defer that promise from the applicable product scope. A clinician report should not accidentally inherit unit-wide or fee-ledger access.

Sources: `spec/atria_spec/roles.py`, `web/src/staff/StaffShell.tsx`, `web/src/staff/Reports.tsx:174`.

### F09 · P2 · Tablet layouts shrink text and controls excessively

**Measured in browser and confirmed in source.** At 768 pixels, the app sets `--fit` to approximately 0.6432, shrinking a 1194-pixel frame to fit. Staff row-action buttons measured about 24.44 × 24.44 CSS pixels. The register technically fits but names, phone numbers, hints and status text become noticeably small. This matters for a tablet used at a busy desk or by a patient with limited vision.

At 390 pixels, mobile specialist date-navigation controls measured 30 × 30; appointment-type choices were 40 pixels high. These measurements are usability concerns, not a blanket claim of WCAG failure: WCAG's minimum target criterion has different dimensions and exceptions from the enhanced 44-pixel target.

**Improve:** use real responsive layouts at readable type sizes, with fewer visible columns and a detail drawer where needed. Aim for 44-pixel important touch controls. Keep motion, gradients and the visual identity, but stop scaling essential text down with the entire canvas.

Sources: `web/src/layout/fit.ts:59`, `web/src/styles/tiers.css`.

![Tablet staff register is scaled down substantially](evidence/tablet-768-staff.jpg)

### F10 · P2 · Patients do not see the fee before confirming a booking

**Observed in the specialist and queue booking interfaces; confirmed by client structure.** The specialist selection/summary shows clinician, day, time and duration, but not the applicable XAF fee. The queue selection likewise does not surface its fee. Amounts appear later in cancellation and closed-visit records. Cost is even offered as a cancellation reason.

**Improve:** show the official applicable fee or a clearly qualified fee basis before booking, with “Pay at the hospital; Atria does not collect payment.” If the final procedure fee depends on assessment, say so and identify when it will be confirmed. Preserve the existing separation between ratings and fees.

Sources: `web/src/patient/FindCare.tsx`, `web/src/patient/JoinQueue.tsx`, `web/src/components/FeeRecord.tsx`.

### F11 · P2 · Pending procedure requests have no withdrawal or response expectation

**Verified in browser.** A patient can send a procedure request with no explanatory note. The resulting detail correctly says no time is held, but provides no withdrawal action, expected response interval, or usable contact path. The note is labelled “What it is for” without an explicit optional marker, despite empty submission succeeding.

**Improve:** label optional fields; explain what information the unit needs; offer a withdrawal path until placement. Show requested-at time, expected review window, and what the patient should do if that interval passes. Make declined requests actionable with a consultation/re-request route.

Sources: `web/src/patient/JoinQueue.tsx`, `web/src/patient/QueueVisit.tsx`.

### F12 · P2 · Quality-programme control gets ahead of the web workflow

**Source and interface finding; not a completed feedback test.** Settings exposes “Collect feedback,” described as asking patients for feedback after a visit. The web client has no patient feedback form or staff feedback review destination in its routes/components. The API backlog still identifies feedback work as outstanding.

**Improve:** gate the control until the whole workflow is available, or clearly mark its effect and release status. When implemented, support attended-visit eligibility, one response per visit, staff review scope and operational handling of flagged feedback. Do not use this work to attach public ratings to named doctors or adjust fees.

Sources: `web/src/staff/Settings.tsx:412`, patient/staff route files, `docs/openapi/routes.md`.

### F13 · P2 · Failed messages need an operational follow-up state

**Verified in browser.** The receptionist message log puts failures first, shows reasons and telephone links, and points staff toward calling the patient. This is a good fallback. It has no “called / reached / retry later / wrong number” state, however, so the next staff member cannot tell whether a failure has already been handled.

**Improve:** attach a minimal audited follow-up outcome and assignee to failed notifications. Keep message delivery state separate from human follow-up. Filter to unresolved failures, and allow a corrected contact record to flow into the authorized future delivery path. Message resend is already identified as future work in the API backlog; do not depict it as implemented.

Sources: `web/src/staff/Messages.tsx`, `docs/openapi/routes.md`.

### F14 · P2 · Support and demographic-correction promises lack a complete destination

**Verified in public help, sign-in and account screens, with source inspection.** Help repeatedly tells people to contact the front desk but supplies no hospital contact action, hours, or route. Patient account copy says the desk can help with email. The inspected register record has no corresponding demographic edit action, and the update route is still in the API backlog.

**Improve:** provide a configured contact path and opening hours before login, plus a clear account-recovery path. Align the wording with what staff can actually change. Implement authorized corrections with identity confirmation and audit, or say explicitly which administrator/process handles them.

Sources: `web/src/pages/Landing.tsx`, `web/src/pages/PatientSignIn.tsx`, `web/src/patient/Account.tsx`, `web/src/staff/Patients.tsx`, `docs/openapi/routes.md`.

### F15 · P2 · Initial delivery is too heavy for the connectivity target

**Measured by production build; no throttled network benchmark was performed.** The build succeeds but warns about large chunks. The primary JavaScript chunk is 1,898.91 kB minified / 571.12 kB gzip. ExcelJS is another 929.56 kB / 256.44 kB gzip. These are emitted file sizes, not a claim that every emitted chunk is fetched on the first page.

The app statically imports route families; administrator reporting and export dependencies should not burden a patient who only wants to sign in or check a booking.

**Improve:** split by public/patient/staff route group and load export libraries only when exporting. Measure actual requests and usable-screen time on constrained connectivity and a modest phone. Establish a bundle budget for the patient entry path.

Sources: `web/src/App.tsx`, `web/src/staff/Reports.tsx`, `web/src/utils/reportExport.ts`; `npm run build` output.

### F16 · P2 · Offline and network-failure behavior needs explicit recovery design

**Source finding, not an offline browser reproduction.** The service worker handles push events and notification clicks; it has no fetch/offline-shell handler. The API client is a direct request wrapper. `NewTimeOffer.take` treats every caught error as “That time was just taken,” then removes the offered slot, including errors that could instead be connection loss or server failure.

**Improve:** distinguish slot conflict, authorization, network failure and server error. Preserve the patient's selection, provide safe retry, and state whether the outcome is unknown. Use idempotency for mutations that may have succeeded before the connection failed. Clearly label stale schedule data and never claim a booking succeeded while offline. Any offline storage design should minimize retained sensitive information.

Sources: `web/public/sw.js`, `web/src/api/client.ts`, `web/src/patient/NewTimeOffer.tsx`.

### F17 · P3 · Administrative labels and visual density need consistency

**Verified in browser.** The Roles table falls back to raw identifiers such as `queue.read`, `patient.delete`, `staff.reset_password`, `staff.update_profile`, and `message.read`, while other rows use plain language. Desktop panels and navigation frequently ellipsize names and secondary text. Week-grid blocks are primarily a time plus clinician color, which makes the purpose harder to identify without opening them.

**Improve:** complete the permission label mapping; preserve accessible full names and reveal critical truncated information on focus/tap. Make week-grid event summaries more informative where space permits. State why a disabled action is unavailable, rather than relying on faded styling.

Source: `web/src/staff/Settings.tsx:1305`, `web/src/staff/WeekView.tsx`, shared row/typography styles.

### F18 · P2 · Outcome percentages disagree between the report and its export

**Verified by the browser report, downloaded CSV, and source.** The Medical Unit weekly report displayed 57 booked visits and 40 attended. Its outcome legend showed 77% attended, while the downloaded CSV said 70% for the same row. The chart divides by the sum of its outcome segments (40 + 5 + 5 + 2 = 52); the export divides by booked visits (57). The chart subtitle describes a share of booked visits, so the difference is unexplained. This is separate from the preview's hardcoded attendance-rate problem P05.

**Improve:** choose one denominator and label it explicitly. If the chart represents all bookings, include open/unresolved visits as a segment. If it represents only closed outcomes, label that and apply the same denominator in PDF, Excel and CSV. Keep the separate attendance rate (attended divided by attended plus no-show) clearly named so readers do not confuse three different percentages.

Sources: `web/src/staff/Reports.tsx:325`, `web/src/components/ExpressiveCharts.tsx:36`, `web/src/utils/reportExport.ts:83`. Download evidence: `Atria Weekly report Medical Unit 2 November to 8 November 2026.csv`.

## Preview defects: fix the test environment before treating it as acceptance evidence

These are specifically preview findings. They should not be presented as proven production failures.

| ID | Reproduction / observation | Source explanation and improvement |
| --- | --- | --- |
| P01 | Move a specialist visit inside the 24-hour window, then cancel. Warning and success message say late/partial; closed fee record says full refund/cancelled in time. | Mock appointment GET reconstructs every patient cancellation as `CANCELLED_IN_WINDOW` and FULL. Persist the actual closure outcome and entitlement. `mockApi.ts:682–720`. |
| P02 | Open `patient-deleted`, press Restore my account. It stays busy, with both actions disabled, instead of entering the restored app. | Mock restore returns success but does not clear deletion; Preview.refresh returns unchanged `me`. Simulate the resulting identity state and cancellation semantics. `mockApi.ts:1732`, `Preview.tsx:171`. |
| P03 | Open `admin-new`. Setup gate appears, then “Signing in is not available right now”; no QR setup can be completed. | Preview identity is mocked but the authenticator setup uses live authentication methods. Supply a clearly identified test adapter, or mark this flow unavailable in preview. Do not infer a deployed authentication outage. |
| P04 | Completing a visit as clinician displays fee ledger and refund. | Mock appointment GET does not apply the ledger permission. The real backend **does** filter `ledger` with `fee_ledger.read` in `appointments.py:232`. Correct the mock; optionally avoid unnecessary client ledger requests when the role lacks access. This is not evidence of production leakage. |
| P05 | Manager weekly report: By phone shows 5 came / 2 did not, but 80%; Referred shows 2 / 1, but 75%. Other role/reminder breakdowns also disagree. | Several mock breakdown rates are hardcoded. Use the same attendance calculation as the displayed counts and the backend. For the 5/2 example, attendance among resolved attended/no-show visits is about 71%, not 80%. |
| P06 | Outpatient desk afternoon session initially says 14 places issued yet its queue list is empty. Morning/session data disappears as time advances. | Tickets are seeded into the first session; session visibility infers patient/staff from `window.location.pathname`, which is always `/__preview…` rather than MemoryRouter's `/console`. Use the explicit caller and seed coherent data in every active session. `mockApi.ts:315`, `:818`. |
| P07 | Synthetic account contact details, patient DOB, message-log numbers and visit choices disagree across screens. Amina has no DOB in the preview identity but 1958 in the register, while the next visit is paediatrics. | Use one synthetic person record per identifier and derive all related fixtures from it. Keep clearly fictional phone numbers; using US test numbers is intentional, not itself an application country-selection bug. |
| P08 | A rescheduled visit can show an SMS delivered earlier the same day before the reschedule happened. Administrator audit examples show roles performing actions the matrix forbids. | Generate event history from actual simulated events and valid role permissions; do not synthesize delivery solely from the current visit start or rotate action names among arbitrary actors. |
| P09 | Delete my account or sign out returns to a fresh, signed-in patient preview with the original bookings. | Preview.signOut deliberately reloads `/__preview`; mock account deletion does not simulate the full lifecycle. Document this behavior or add a preview signed-out state. Do not use it to validate production deletion/sign-out. |

Preview coverage should eventually include full sessions, empty weeks, no matching clinicians, stale versions, denied roles, account suspension during use, request placement conflicts, late cancellations, duplicate/shared phone records, minors and guardians, and delivery failure. Each scenario needs a clear starting state and a reset action. Changing roles in one browser currently reloads and resets the in-memory model, so a patient request created in one preview cannot simply be followed through by switching to the surgeon preview.

![Restoration stays busy in the preview](evidence/patient-restore-stuck.jpg)

## Hands-on coverage ledger

“Completed” below means the local UI reached an observed result, using the mock backend. “Inspected” means the interface and available choices were reviewed without proving the full outcome. “Limited” names a concrete remaining gap.

| Area / persona | Work performed | Result / limit |
| --- | --- | --- |
| Visitor | Landing, service-line content, help disclosure, public account entry points; FAQ/language copy inspected. | Public entry routes available; support lacks a direct contact action. Not every FAQ animation or external destination was clicked. |
| Patient registration | Blank submission; field errors; birth-date picker; terms checkbox and Google entry inspected. | Missing fields receive clear errors. Registration not completed against live Cognito; terms have no links. |
| Patient sign-in / recovery | Sign-in controls, keep-signed-in default, Google option, forgot-password navigation. | Interfaces inspected; no real credentials, reset email or new credential submitted. |
| Staff sign-in / recovery | Work-email/password fields, trust-workstation option, recovery screen. | Interface inspected; phone-only account guidance mismatch. First-password replacement and real TOTP sign-in not completed. |
| Patient home | Next-visit summary, upcoming list, quick actions and details navigation. | Working; disrupted visit competes visually with ordinary confirmed visits. |
| Patient visit confirmation | “I'll be there.” | Completed; observed confirmation message and history entry. |
| Pre-visit intake | Empty Save, required answer validation, synthetic text plus consent, Save. | Completed; saved answers appeared in visit detail. |
| Patient reschedule | Open move dialog, inspect days/times, choose replacement, submit. | Completed; reference preserved and date/time/history updated. |
| Patient disruption | Open seeded NEW TIME NEEDED visit, choose one of three offers. | Completed; chosen offer became moved visit. No concurrent-offer race or unavailable-server test. |
| Patient cancellation | Reason selection; late cancellation after moving inside 24 hours. | Completed; visit moved to past list. Preview refund inconsistency found. |
| Specialist booking | Choose slot; booking intake dialog; Book without answers. | Forced 10:00 preview conflict reproduced. |
| Slot-conflict recovery | Inspect closest openings, select alternative, Hold this slot. | Completed; “You are booked” confirmation and reference observed. Raw `409` wording is unnecessary for patients. |
| Calendar | Open Add to calendar; choose Apple/file export. | `.ics` downloaded and verified on disk. Google/Outlook choices inspected, external event creation not completed. |
| General queue booking | Select today's afternoon session, Take a place. | Completed; place number, reference and 15:52–16:22 arrival window observed. |
| Queue withdrawal | Give up my place → Cancel visit. | Completed; cancelled screen still instructs arrival. Reproduced again for screenshot evidence. |
| Procedure request | Send an empty-note request. | Completed; REQUESTED detail and no-held-time explanation observed. No withdrawal action. |
| Patient account | Name editor and synthetic name update. | Completed; profile and sidebar name updated. DOB editing inspected, not exhaustively tested. |
| Patient notifications | Fixed reminder timing, preview SMS, device notification control. | Inspected; live push delivery not tested. Mock has no hospital public push key. |
| Patient units/map | Unit list, site map, selected-unit details, hours and directions link. | Inspected desktop and phone. Google Maps destination not tested as a route/entrance accuracy guarantee. |
| Patient deletion | Open explanation and submit recoverable mock deletion. | Redirected to fresh signed-in preview; mock limitation P09. No permanent deletion performed. |
| Google incomplete profile | Open persona; blank Continue. | Validation observed. Completed onboarding not established by preview; accepted-terms path not submitted. |
| Deleted patient | Open persona; Restore my account. | Stuck busy; P02. |
| Receptionist schedule | Day list, selected visit, open detail, clinical-context exclusion. | Inspected; private answers were not shown. |
| Receptionist arrival | Record arrival for Ines. | Completed; ARRIVED and history/toast observed. |
| Receptionist no-show | Open overdue Chantal visit; inspect “They came” alternative; Mark no-show. | Completed; no-show state, history and ledger observed. |
| Patient registration by desk | New patient, synthetic name/mobile, Save and book. | Completed; register number and staff-booking screen observed. Shared-phone confirmation branch not executed. |
| Staff-assisted booking | Walk-in channel/full-today state, switch to Phone, choose clinician/time, Book visit. | Completed; booking detail attributes it to receptionist and phone channel. Referral channel not completed. |
| Staff reschedule | Open Move, inspect required reason choices. | Inspected; patient-side move completed separately. Self-benefit refusal and staff move commit not executed. |
| Receptionist roster | Unit staff, on-shift state, hours and utilization. | Inspected. |
| Receptionist availability | Disabled hours, time-off affordance. | Read-only hours observed. Unavailability action is distinct from editing weekly hours. |
| Receptionist messages | Failed-first log, failure reasons, phone and visit links. | Inspected; no external phone call or message sent. |
| Clinician consultation | Own schedule; arrival → Start consultation → Complete visit. | Completed; terminal state and history observed. Fee display identified as preview mismatch. |
| Clinician hours | Turn Friday off → Save hours. | Completed; persisted within the preview and success message observed. Existing-booking impact not established. |
| Clinician unavailability | Open time-off dialog, inspect Block/Leave/Unavailable, choose Unavailable with reason, save. | Completed; entry appeared. Preview returned “No visits affected”; did not establish end-to-end real disruption. |
| General practitioner | Open GP persona and inspect its schedule/queue navigation. | Inspected; GP-specific consultation completion in queue was not repeated. |
| Outpatient desk | Queue, Add walk-in, patient search, select Brice, issue place, record arrival, choose doctor, Call next. | Completed; patient assigned to Dr Walters Mbua and IN CONSULTATION. |
| Outpatient sessions | Inspect Sessions list and published capacities. | Inspected. No outpatient-manager persona is supplied; session publication and closure not completed. |
| Surgeon | Request inbox, Place first request, choose time, submit. | Completed; request left inbox and patient-confirmation notice observed. Duration control missing. |
| Surgeon decline | Decline another request, enter patient-readable reason, submit. | Completed; request removed from waiting list. Patient-side result not followed across a role switch because preview resets. |
| Unit manager schedule | Day/week views, clinician load and calendar layout. | Inspected. |
| Unit manager reports | Weekly counts, outcome/channel/role/reminder breakdowns, ledger, download menu. | Inspected; CSV downloaded and verified on disk. Day/month/year and PDF/Excel exports not all completed. |
| Unit manager audit | Weekly flagged changes, Full log, Changes filter and result count. | Filter completed; audit export and new action-to-log consistency not proved. |
| Administrator overview | Account/delivery KPIs, capacity issues, quick actions. | Inspected; screenshot saved. |
| Administrator staff | Create synthetic receptionist, keyboard workaround for unit picker, result credentials screen, return to register. | Completed; 26-user count and new account observed. Credential copying/PDF handoff not completed. |
| Administrator suspension | Suspend synthetic account, inspect resulting menu. | Completed; SUSPENDED observed, no normal recovery action. |
| Other staff actions | Priority allowance dialog, available role/password actions. | Inspected; allowance grant, clinician-profile correction and password reissue were not committed. |
| Imports | Staff import dialog and generated template download. | Template verified on disk. Browser file upload blocked by extension file-access permission; import rows and submission not verified. Patient import UI not fully exercised. |
| Hospital settings | Hospital policy fields/locks, Units, Visit types, Intake forms, Fees, Roles. | All six tabs inspected. Unit/type/fee dialogs opened; destructive unit action cancelled. |
| Intake management | New synthetic form with one question → Add form. | Completed; form appeared as version 1, Not used yet. Full version history and assignment-to-patient round trip not verified. |
| Administrator onboarding | Open `admin-new`. | Gate works; setup itself fails in preview, P03. |
| Administrator patient record | Open patient, inspect contact/visits and clinical-context exclusion. | Inspected; no operational booking action offered. |
| Responsive | Desktop key screens; 768-pixel staff list; 390-pixel patient account/units/booking and admin list/More/reports. | Mobile navigation and report reflow worked in sampled screens. Not every route at every breakpoint. |

## Visual and interaction direction

Keep the blue patient/staff and purple administration identity, rounded cards, clear state chips, and the mobile bottom navigation. A redesign is not the first need.

1. **Make the next action obvious.** Put disrupted appointments and unresolved procedure offers above ordinary upcoming visits. Keep critical visit actions in a predictable position. Use patient language such as “Choose another time”; technical status codes belong in diagnostics.
2. **Use readable surfaces.** Increase secondary-text readability and reduce transparency behind dense operational data. Verify actual contrast on rendered gradients; this audit did not compute a full contrast matrix.
3. **Reduce simultaneous scrolling.** Desktop lists and detail panes can scroll independently. A short window hides useful actions and information. Use clear pane boundaries, sensible sticky headers/actions, and preserve the selected row when returning from a detail page.
4. **Make status control the whole screen.** Arrival windows, reminder promises, doctor assignment, cancellation, completion and request placement must all agree. A colored chip alone is insufficient if the rest of the copy describes the wrong state.
5. **Improve mobile touch ergonomics.** The phone layouts generally work well; enlarge small calendar arrows and chooser controls and verify focus does not disappear behind fixed bottom bars or open sheets.
6. **Give feedback after every consequential action.** Keep existing toasts and timelines, but ensure they agree with the persisted record. Never show indefinite “Working” after a known result. Provide retry or a recoverable error state.

For accessibility targets, use the official W3C criteria as acceptance references: [contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) specifies 4.5:1 for ordinary text, with exceptions; [target size enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced) describes the 44 × 44 target goal. Small targets in this review are not automatically reported as failures of the separate minimum-size criterion.

![A sampled phone report reflows without document-wide horizontal overflow](evidence/mobile-admin-report.jpg)

## Improvements most closely tied to Atria's audience

| Need | Improvement | Useful success measure |
| --- | --- | --- |
| Book without understanding hospital administration | Lead with “See a doctor today,” “Book a specialist,” “Request a procedure”; allow unit/specialty discovery without already knowing a clinician. Consider a small public directory before requiring registration. | Patient can identify the correct route and understand whether a time is held without help. |
| Make a financially informed choice | Show fee/basis and cancellation terms before confirmation. Keep payment-at-hospital wording. | Patient can state the fee and cancellation consequence before booking. |
| Avoid unnecessary travel | Prioritize disruptions and accurate arrival/withdrawal copy, with unit entrance details and reliable notifications. | Cancelled patients never see active attendance instructions; disrupted patients can identify their required next action. |
| Operate with intermittent connectivity | Smaller patient bundles; explicit offline/stale state; safe idempotent retry; clear uncertain outcomes. | Retry after lost response creates one booking; no false success or unexplained loss of selection. |
| Support English and French speakers | Prioritize French UI and notification localization when scheduling permits. The current landing accurately says English only; this is an audience improvement, not a claim that the current phase promised bilingual screens. | A patient can complete booking/recovery and understand the reminder in their chosen supported language. |
| Serve children and shared-phone households | Complete the guardian/dependant and shared-number journeys with clear patient identity selection and consent responsibilities. These are scope gaps, not workflows proven by an adult preview. | Staff and guardians can identify whose record and appointment are being changed at every step. |
| Help the desk resolve failures | Unresolved-reminder follow-up, inline registration from queue when feasible, and clear no-availability alternatives. | A failed reminder has an owner and outcome; a walk-in can be registered without losing session context. |
| Preserve institutional trust | Accurate privacy/terms documents, understandable access descriptions, correct audit fixtures and permission-aligned previews. | UI promises, API behavior and published policy agree. |

## Verification results

- `npm run typecheck`: passed.
- `npm test -- --reporter=dot`: **40 test files, 251 tests passed**. Existing warnings included jsdom canvas support and some React `act(...)` warnings; they did not fail the run.
- `npm run build`: passed. Vite emitted a large-chunk warning; relevant sizes are recorded in F15.
- Selected backend suite passed: `tests/services/test_queue.py`, `test_staff_endpoints.py`, `test_care_context.py`, and `test_settings.py`, run through the repository virtual environment. This was a targeted suite, not the entire backend suite or a deployed integration test.
- Downloaded files verified in the local Downloads folder: `atria-APT-7835.ics` (520 bytes), the Medical Unit weekly CSV (1,089 bytes), and `Atria Staff import template.xlsx` (21,129 bytes). File presence is not a claim of full cross-application import or visual export validation.
- Browser console sample at the final administrator record contained no captured error/warning messages. This is a sampled diagnostic, not proof that no console error occurred anywhere during the review.

Passing component tests did not catch the picker obstruction because DOM tests do not establish real overlay stacking or pointer hit targets. Add a small real-browser acceptance suite around the key role workflows and the observed failures. Derive lifecycle fixtures and permission expectations from the specification so the mock, UI and backend do not drift.

## Remaining checks before a pilot

The following were not established by this review: real Cognito sign-in/Google callback and password replacement; actual administrator TOTP setup/recovery; SMS/email/push delivery; permission enforcement against authenticated deployed API calls; two-client slot races and idempotent lost-response retry; stale staff updates; guardian/dependant consent; session publication/closure and disruption under staffing changes; all import validation and partial-success branches; every export format; keyboard focus trapping across all dialogs; full contrast/screen-reader testing; all browsers/devices; Flutter runtime parity; deployment/backup/restore/retention execution.

File upload was blocked by the browser extension's file-access setting, not by an observed Atria import parser failure. To enable file upload, open chrome://extensions, click Details under the ChatGPT browser extension, and enable "Allow access to file URLs." See [here](https://developers.openai.com/codex/app/chrome-extension#upload-files) for details. No extension permission was changed during this audit.

## Recommended order of work

1. Fix shared overlay stacking, false unit-restoration copy/dependency protection, cancelled-ticket instructions, legal-document access, suspension recovery, and procedure sizing.
2. Repair preview lifecycle/permissions/report fixtures and add missing role/scenario starting states. The preview must be trustworthy before it serves as acceptance evidence.
3. Align staff phone/email access, clinician reporting scope, report/export denominators, upfront fees, pending-request handling, and quality-programme availability with the implemented product.
4. Improve tablet readability, low-connectivity delivery, message follow-up, and usable support/correction paths.
5. Run the remaining integrated scenarios with synthetic data against a controlled backend, then validate the patient and front-desk flows with representative users.
